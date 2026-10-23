import { NextRequest, NextResponse } from "next/server";
import { X509Certificate, createVerify } from "crypto";
import { sql } from "@/lib/db";
import { PATCH as concluirProducao } from "@/app/api/producoes/[id]/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- Verificacao de requisicao Alexa (certificado + assinatura + timestamp) ----
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

function fala(texto: string, encerrar = true) {
  return NextResponse.json({
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text: texto },
      shouldEndSession: encerrar,
    },
  });
}

// "impressora 3" -> maquina cujo nome tem o numero 3; senao usa a posicao.
async function acharMaquina(n: number) {
  const maquinas = (await sql`SELECT id, nome FROM machines ORDER BY id`) as { id: number; nome: string }[];
  const porNome = maquinas.filter((m) => new RegExp(`-\\s*${n}\\s*$`).test(m.nome.trim()));
  if (porNome.length === 1) return porNome[0];
  if (porNome.length === 0 && maquinas[n - 1]) return maquinas[n - 1];
  return null;
}

async function concluir(n: number, falha: boolean) {
  const m = await acharMaquina(n);
  if (!m) return fala(`Nao encontrei a impressora ${n}.`);
  const rows = (await sql`
    SELECT pr.id, pl.nome AS placa FROM producoes pr
    JOIN placas pl ON pl.id = pr.placa_id
    WHERE pr.machine_id = ${m.id} AND pr.status = 'em_andamento'
    ORDER BY pr.iniciado_em DESC
  `) as { id: number; placa: string }[];
  if (rows.length === 0) return fala(`A impressora ${n} nao tem nenhuma placa em andamento no sistema.`);
  if (rows.length > 1) return fala(`A impressora ${n} tem ${rows.length} producoes em andamento. Conclua pela tela para nao errar.`);
  const p = rows[0];
  const req = new NextRequest(`https://x/api/producoes/${p.id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: falha ? "falha_placa" : "concluida" }),
  });
  const res = await concluirProducao(req, { params: { id: String(p.id) } });
  if (!res.ok) return fala("Nao consegui concluir no sistema. Confira pela tela.");
  return fala(falha ? `Registrei falha na placa ${p.placa}, impressora ${n}.` : `Pronto. Placa ${p.placa} da impressora ${n} concluida.`);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "json" }, { status: 400 });
  }

  // Seguranca: assinatura Alexa, janela de 150s, skill e usuario autorizados
  const ts = new Date(body?.request?.timestamp).getTime();
  if (!ts || Math.abs(Date.now() - ts) > 150_000) return NextResponse.json({ error: "timestamp" }, { status: 400 });
  if (!(await verificarAlexa(req, raw).catch(() => false))) return NextResponse.json({ error: "assinatura" }, { status: 400 });
  const skillId = body?.session?.application?.applicationId || body?.context?.System?.application?.applicationId;
  if (process.env.ALEXA_SKILL_ID && skillId !== process.env.ALEXA_SKILL_ID) return NextResponse.json({ error: "skill" }, { status: 403 });
  const userId = body?.session?.user?.userId || body?.context?.System?.user?.userId;
  const permitido = process.env.ALEXA_USER_ID;
  const r = body?.request;

  if (r?.type === "LaunchRequest") return fala("Morolar pronta. Diga: impressora 1 terminou.", false);
  if (r?.type === "SessionEndedRequest") return NextResponse.json({ version: "1.0", response: {} });
  if (r?.type !== "IntentRequest") return fala("Nao entendi.");

  // Sem ALEXA_USER_ID configurado: nao executa nada, so registra o ID nos logs.
  if (!permitido) {
    console.log("ALEXA_USER_ID =", userId);
    return fala("Configuracao inicial feita. Falta ativar no sistema.");
  }
  if (userId !== permitido) return fala("Usuario nao autorizado.");

  const nome = r.intent?.name as string;
  if (nome === "AMAZON.HelpIntent") return fala("Diga: impressora 2 terminou.", false);
  if (nome === "AMAZON.StopIntent" || nome === "AMAZON.CancelIntent") return fala("Ok.");
  if (nome === "ConcluirPlacaIntent" || nome === "FalhaPlacaIntent") {
    const n = parseInt(r.intent?.slots?.numero?.value, 10);
    if (!n) return fala("Qual impressora?", false);
    return concluir(n, nome === "FalhaPlacaIntent");
  }
  return fala("Nao entendi. Diga: impressora 1 terminou.");
}
