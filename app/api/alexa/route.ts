import { NextRequest, NextResponse } from "next/server";
import { X509Certificate, createVerify } from "crypto";
import { sql } from "@/lib/db";
import { PATCH as concluirProducao } from "@/app/api/producoes/[id]/route";
import { GET as getProducoes, POST as postProducao } from "@/app/api/producoes/route";
import { GET as getPlacas } from "@/app/api/placas/route";
import { GET as getDemanda } from "@/app/api/producao/demanda/route";
import { GET as getFilamento } from "@/app/api/producao/filamento/route";
import { GET as getJanela } from "@/app/api/producao/janela/route";
import { GET as getEnviosFull } from "@/app/api/full/envios/route";
import { corFilamentoDaPlaca, corPetgDe, CORES_COM_PETG } from "@/lib/placas";
import { horaAtualSP, horasAteProximaAbertura } from "@/lib/date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// ---- Verificação de requisição Alexa (certificado + assinatura + timestamp) ----
const certCache = new Map<string, string>();

function certUrlValida(u: string): boolean {
  try {
    const url = new URL(u);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "s3.amazonaws.com" &&
      url.pathname.startsWith("/echo.api/") &&
      (url.port === "" || url.port === "443")
    );
  } catch {
    return false;
  }
}

async function verificarAlexa(req: NextRequest, raw: string): Promise<boolean> {
  const certUrl = req.headers.get("signaturecertchainurl") || "";
  const sig = req.headers.get("signature-256") || "";
  if (!certUrlValida(certUrl) || !sig) return false;
  let pem = certCache.get(certUrl);
  if (!pem) {
    const r = await fetch(certUrl);
    if (!r.ok) return false;
    pem = await r.text();
    certCache.set(certUrl, pem);
  }
  const leaf = new X509Certificate(pem.split("-----END CERTIFICATE-----")[0] + "-----END CERTIFICATE-----");
  const agora = Date.now();
  if (agora < new Date(leaf.validFrom).getTime() || agora > new Date(leaf.validTo).getTime()) return false;
  if (!(leaf.subjectAltName || "").includes("echo-api.amazon.com")) return false;
  const v = createVerify("RSA-SHA256");
  v.update(raw);
  return v.verify(leaf.publicKey, Buffer.from(sig, "base64"));
}

// ---- Respostas ----
type Sessao = Record<string, any>;

function fala(texto: string, encerrar = true, sessao?: Sessao) {
  const resp: any = {
    version: "1.0",
    sessionAttributes: sessao ?? {},
    response: {
      outputSpeech: { type: "PlainText", text: texto },
      shouldEndSession: encerrar,
    },
  };
  if (!encerrar) resp.response.reprompt = { outputSpeech: { type: "PlainText", text: "Pode responder." } };
  return NextResponse.json(resp);
}

// "impressora 3" -> procura máquina cujo nome termine com o número 3; senão usa a posição.
async function acharMaquina(n: number) {
  const maquinas = (await sql`SELECT id, nome FROM machines ORDER BY id`) as { id: number; nome: string }[];
  const porNome = maquinas.filter((m) => new RegExp(`-\\s*${n}\\s*$`).test(m.nome.trim()));
  if (porNome.length === 1) return porNome[0];
  if (porNome.length === 0 && maquinas[n - 1]) return maquinas[n - 1];
  return null;
}

// ---- Fila de prioridade (espelho de filaPrioridade em app/producao/page.tsx) ----
async function lerJson(h: any): Promise<any> {
  const res = await h(new NextRequest("https://x/api"));
  return res.json();
}

const DUAS_SEMANAS_MS = 14 * 24 * 60 * 60 * 1000;
const vendeuRecente = (d: any) => !!d?.ultimaVendaEm && Date.now() - new Date(d.ultimaVendaEm).getTime() <= DUAS_SEMANAS_MS;
const diasDeEstoque = (est: number, media: number) => (media <= 0 ? Infinity : (est / media) * 7);

async function montarFila(): Promise<{ id: number; nome: string; cor: string | null }[]> {
  const [placas, producoes, demandaRes, filamento, janelaRes, envios] = await Promise.all([
    lerJson(getPlacas),
    lerJson(getProducoes),
    lerJson(getDemanda),
    lerJson(getFilamento),
    lerJson(getJanela),
    lerJson(getEnviosFull),
  ]);
  const janela = janelaRes ?? { aberturaHora: 9, fechamentoHora: 23 };
  const hora = horaAtualSP();
  const pertoDoFechamento = hora < janela.aberturaHora || hora >= janela.fechamentoHora || hora >= janela.fechamentoHora - 3;

  const demandaPorPlaca = new Map<number, any>();
  for (const d of demandaRes?.demanda ?? []) demandaPorPlaca.set(d.placaId, d);

  const emProducaoPorPlaca = new Map<number, number>();
  for (const p of producoes as any[]) {
    if (p.status !== "em_andamento") continue;
    emProducaoPorPlaca.set(p.placa_id, (emProducaoPorPlaca.get(p.placa_id) ?? 0) + Number(p.quantidade_placas) * Number(p.pecas_por_placa));
  }

  const envioFullPorPlaca = new Map<number, number>();
  for (const e of (Array.isArray(envios) ? envios : []) as any[]) {
    if (e.status !== "pendente") continue;
    envioFullPorPlaca.set(e.placaId, Math.max(envioFullPorPlaca.get(e.placaId) ?? 0, e.faltantePlaca));
  }

  const qtdNoite = (t: number) => (!t || t <= 0 ? 1 : Math.max(1, Math.ceil(horasAteProximaAbertura(janela.aberturaHora) / t)));

  const itens = (placas as any[])
    .map((placa) => {
      const demanda = demandaPorPlaca.get(placa.id);
      const emProducao = emProducaoPorPlaca.get(placa.id) ?? 0;
      const estoqueProjetado = placa.estoque + emProducao;
      return {
        placa,
        demanda,
        estoqueProjetado,
        aProduzirEfetivo: Math.max(0, (demanda?.aProduzir ?? 0) - emProducao),
        faltaDespacho: Math.max(0, (demanda?.pecasPendentesDespacho ?? 0) - estoqueProjetado),
        faltaEnvioFull: envioFullPorPlaca.get(placa.id) ?? 0,
      };
    })
    .filter((i) => i.aProduzirEfetivo > 0 || i.faltaDespacho > 0 || i.faltaEnvioFull > 0 || Boolean(i.placa.saidaExtraPlacaId))
    .filter((i) => {
      if (i.faltaEnvioFull > 0) return true;
      if (i.estoqueProjetado <= 0 && vendeuRecente(i.demanda)) return true;
      if (i.placa.saidaExtraPlacaId) return true;
      if (!filamento) return true;
      const cor = corFilamentoDaPlaca(i.placa.nome);
      if (!cor) return true;
      const pla = (filamento as any)[cor] ?? 0;
      const petg = (CORES_COM_PETG as readonly string[]).includes(cor) ? (filamento as any)[corPetgDe(cor as any)] ?? 0 : 0;
      return pla + petg > 0;
    });

  itens.sort((a, b) => {
    const envio = b.faltaEnvioFull - a.faltaEnvioFull;
    if (envio !== 0) return envio;
    const backlog = b.faltaDespacho - a.faltaDespacho;
    if (backlog !== 0) return backlog;
    const rec = (vendeuRecente(a.demanda) ? 0 : 1) - (vendeuRecente(b.demanda) ? 0 : 1);
    if (rec !== 0) return rec;
    const da = diasDeEstoque(a.estoqueProjetado, a.demanda?.mediaSemanal ?? 0);
    const db = diasDeEstoque(b.estoqueProjetado, b.demanda?.mediaSemanal ?? 0);
    if (da !== db) return da < db ? -1 : 1;
    if (pertoDoFechamento) {
      const v = qtdNoite(a.placa.tempoPlacaHoras) - qtdNoite(b.placa.tempoPlacaHoras);
      if (v !== 0) return v;
    }
    const vol = (b.demanda?.mediaSemanal ?? 0) - (a.demanda?.mediaSemanal ?? 0);
    if (vol !== 0) return vol;
    if (!pertoDoFechamento) {
      const t = a.placa.tempoPlacaHoras - b.placa.tempoPlacaHoras;
      if (t !== 0) return t;
    }
    return b.placa.tempoPlacaHoras - a.placa.tempoPlacaHoras;
  });

  return itens.map((i) => ({ id: i.placa.id, nome: i.placa.nome as string, cor: corFilamentoDaPlaca(i.placa.nome) as string | null }));
}

// Texto falado do nome da placa (tira símbolos que a Alexa lê mal).
const falavel = (nome: string) => nome.replace(/[()]/g, "").replace(/\s+/g, " ").trim();

async function sugerir(n: number, prefixo: string, listaPronta?: number[], nomes?: Record<string, string>, indice = 0) {
  const m = await acharMaquina(n);
  if (!m) return fala(`${prefixo}Não encontrei a impressora ${n}.`);
  const ocupada = (await sql`SELECT 1 FROM producoes WHERE machine_id = ${m.id} AND status = 'em_andamento' LIMIT 1`) as any[];
  if (ocupada.length > 0) return fala(`${prefixo}A impressora ${n} já tem uma placa em andamento.`);

  let ids = listaPronta;
  let mapa = nomes;
  if (!ids) {
    const fila = await montarFila();
    ids = fila.slice(0, 8).map((f) => f.id);
    mapa = Object.fromEntries(fila.slice(0, 8).map((f) => [String(f.id), f.nome]));
  }
  if (!ids || ids.length === 0 || indice >= ids.length) return fala(`${prefixo}Não tenho mais nada para sugerir na fila.`);
  const pid = ids[indice];
  const nome = (mapa ?? {})[String(pid)] ?? "placa";
  return fala(`${prefixo}Para a impressora ${n}, a prioridade é ${falavel(nome)}. Carrego?`, false, {
    maq: n,
    ids,
    nomes: mapa,
    i: indice,
  });
}

async function concluir(n: number, falha: boolean) {
  const m = await acharMaquina(n);
  if (!m) return fala(`Não encontrei a impressora ${n}.`);
  const rows = (await sql`
    SELECT pr.id, pl.nome AS placa FROM producoes pr
    JOIN placas pl ON pl.id = pr.placa_id
    WHERE pr.machine_id = ${m.id} AND pr.status = 'em_andamento'
    ORDER BY pr.iniciado_em DESC
  `) as { id: number; placa: string }[];
  if (rows.length === 0) return sugerir(n, `A impressora ${n} não tinha placa em andamento. `);
  if (rows.length > 1) return fala(`A impressora ${n} tem ${rows.length} produções em andamento. Conclua pela tela para não errar.`);
  const p = rows[0];
  const req = new NextRequest(`https://x/api/producoes/${p.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: falha ? "falha_placa" : "concluida" }),
  });
  const res = await concluirProducao(req, { params: { id: String(p.id) } });
  if (!res.ok) return fala("Não consegui concluir no sistema. Confira pela tela.");
  const ok = falha ? `Registrei falha na placa ${falavel(p.placa)}, impressora ${n}. ` : `Placa ${falavel(p.placa)} da impressora ${n} concluída. `;
  return sugerir(n, ok).catch(() => fala(ok + "Não consegui montar a próxima sugestão."));
}

async function carregar(sessao: Sessao, material: "PLA" | "PETG") {
  const n = Number(sessao.maq);
  const pid = Number(sessao.ids?.[sessao.i]);
  const m = await acharMaquina(n);
  if (!m || !pid) return fala("Perdi o contexto. Diga: impressora e o número terminou.");
  const req = new NextRequest("https://x/api/producoes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ machineId: m.id, placaId: pid, quantidadePlacas: 1, material: material === "PETG" ? "PETG" : undefined }),
  });
  const res = await postProducao(req);
  if (!res.ok) {
    let msg = "Não consegui carregar.";
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {}
    return fala(msg);
  }
  const nome = sessao.nomes?.[String(pid)] ?? "placa";
  return fala(`Carreguei ${falavel(nome)} na impressora ${n}${material === "PETG" ? ", em PETG" : ""}. Bom trabalho.`);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }

  // Segurança: assinatura Alexa, janela de 150s, skill e usuário autorizados
  const ts = new Date(body?.request?.timestamp).getTime();
  if (!ts || Math.abs(Date.now() - ts) > 150_000) return NextResponse.json({ error: "timestamp" }, { status: 400 });
  if (!(await verificarAlexa(req, raw).catch(() => false))) return NextResponse.json({ error: "assinatura" }, { status: 400 });
  const skillId = body?.session?.application?.applicationId || body?.context?.System?.application?.applicationId;
  if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) return NextResponse.json({ error: "skill" }, { status: 403 });
  const userId = body?.session?.user?.userId || body?.context?.System?.user?.userId;
  const permitido = process.env.ALEXA_USER_ID;
  const r = body?.request;
  const sessao: Sessao = body?.session?.attributes ?? {};

  if (r?.type === "LaunchRequest") return fala("Minhas impressoras. Diga: impressora 1 terminou.", false);
  if (r?.type === "SessionEndedRequest") return NextResponse.json({ version: "1.0", response: {} });
  if (r?.type !== "IntentRequest") return fala("Não entendi.");

  // Primeira vez (sem ALEXA_USER_ID): grava o ID nos logs da Vercel e não executa nada.
  if (!permitido) {
    console.log("ALEXA_USER_ID =", userId);
    return fala("Configuração inicial feita. Peça ao Guilherme para finalizar a ativação.");
  }
  if (userId !== permitido) return fala("Usuário não autorizado.");

  const nome = r.intent?.name as string;
  const temSugestao = Array.isArray(sessao.ids) && sessao.maq;

  try {
    if (nome === "AMAZON.HelpIntent") return fala("Diga: impressora 2 terminou. Depois eu sugiro a próxima placa e você confirma.", false, sessao);
    if (nome === "AMAZON.StopIntent" || nome === "AMAZON.CancelIntent") return fala("Ok.");

    if (nome === "ConcluirPlacaIntent" || nome === "FalhaPlacaIntent") {
      const n = parseInt(r.intent?.slots?.numero?.value, 10);
      if (!n) return fala("Qual impressora?", false, sessao);
      return await concluir(n, nome === "FalhaPlacaIntent");
    }

    if (nome === "SugerirIntent") {
      const n = parseInt(r.intent?.slots?.numero?.value, 10);
      if (!n) return fala("Para qual impressora?", false, sessao);
      return await sugerir(n, "");
    }

    if (nome === "AMAZON.YesIntent") {
      if (!temSugestao) return fala("Não tenho nada pendente.");
      const pid = sessao.ids[sessao.i];
      const nomePlaca = sessao.nomes?.[String(pid)] ?? "";
      const cor = corFilamentoDaPlaca(nomePlaca);
      if (cor && (CORES_COM_PETG as readonly string[]).includes(cor)) {
        return fala("PLA ou PETG?", false, { ...sessao, aguardaMaterial: true });
      }
      return await carregar(sessao, "PLA");
    }

    if (nome === "MaterialIntent") {
      if (!temSugestao) return fala("Não tenho nada pendente.");
      const resolvido = r.intent?.slots?.material?.resolutions?.resolutionsPerAuthority?.[0]?.values?.[0]?.value?.name;
      const bruto = String(resolvido || r.intent?.slots?.material?.value || "").toUpperCase();
      const material = bruto.includes("PETG") ? "PETG" : bruto.includes("PLA") ? "PLA" : null;
      if (!material) return fala("PLA ou PETG?", false, sessao);
      return await carregar(sessao, material);
    }

    if (nome === "AMAZON.NoIntent" || nome === "ProximaIntent") {
      if (!temSugestao) return fala("Ok.");
      return await sugerir(Number(sessao.maq), "Ok. ", sessao.ids, sessao.nomes, Number(sessao.i) + 1);
    }
  } catch (e) {
    console.error("alexa erro", e);
    return fala("Deu erro no sistema. Confira pela tela.");
  }

  return fala("Não entendi. Diga: impressora 1 terminou.");
}
