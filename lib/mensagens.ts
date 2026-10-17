// Mensagens de clientes (ML: perguntas + pos-venda; Shopee: chat) num
// formato unico pra aba /mensagens. Tudo ao vivo (sem cache em banco):
// cada abertura da aba consulta a API das plataformas.
//
// ML  - perguntas (pre-venda):  GET /questions/search, POST /answers
//     - pos-venda:              GET /messages/unread, GET/POST /messages/packs/{pack}/sellers/{seller}
// Shopee - chat do vendedor:    /api/v2/sellerchat/*  (exige a permissao
//          "Chat" habilitada no app do Shopee Open Platform)
import { getValidMLAccessToken } from "./ml-auth";
import { ML_API_BASE } from "./mercadolivre";
import { signAuthenticatedRequest } from "./shopee";
import { getValidShopeeAccessToken } from "./shopee-auth";

export type Plataforma = "ml" | "shopee";
export type TipoConversa = "pergunta" | "posvenda" | "chat";

export interface Conversa {
  id: string; // id unico usado nas rotas (ex: "q:123", "p:2000001/456", "s:abc")
  plataforma: Plataforma;
  tipo: TipoConversa;
  titulo: string; // produto (ML) ou nome do comprador (Shopee)
  comprador: string;
  ultimaMensagem: string;
  data: string; // ISO
  naoLida: boolean;
  thumbnail?: string | null;
  respondida?: boolean;
  cancelada?: boolean; // pos-venda de pedido cancelado: ML bloqueia resposta
  mediacao?: boolean; // pedido com reclamacao/mediacao: ML bloqueia o chat normal
}

export interface Mensagem {
  id: string;
  de: "cliente" | "loja";
  texto: string;
  data: string; // ISO
}

export interface ListaResultado {
  conectado: boolean;
  erro?: string;
  conversas: Conversa[];
}

export interface ThreadResultado {
  conectado: boolean;
  erro?: string;
  mensagens: Mensagem[];
  contexto?: string;
}

// ---------------------------------------------------------------- ML

async function mlGet(path: string, token: string): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(`${ML_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function mlTitulos(
  ids: string[],
  token: string
): Promise<Map<string, { title: string; thumbnail: string | null }>> {
  const map = new Map<string, { title: string; thumbnail: string | null }>();
  const unicos = Array.from(new Set(ids)).filter(Boolean);
  for (let i = 0; i < unicos.length; i += 20) {
    const lote = unicos.slice(i, i + 20);
    const r = await mlGet(`/items?ids=${lote.join(",")}&attributes=id,title,thumbnail`, token);
    if (!r.ok || !Array.isArray(r.data)) continue;
    for (const entry of r.data) {
      const b = entry?.body;
      if (b?.id) map.set(b.id, { title: b.title ?? b.id, thumbnail: b.thumbnail ?? null });
    }
  }
  return map;
}

// true se o pedido/pacote esta cancelado (o ML bloqueia mensagens nesses casos)
async function mlPedidoCancelado(id: string, token: string): Promise<boolean> {
  const o = await mlGet(`/orders/${id}`, token);
  if (o.ok) return o.data?.status === "cancelled";
  const p = await mlGet(`/packs/${id}`, token);
  if (!p.ok) return false;
  if (p.data?.status === "cancelled") return true;
  const orders: any[] = p.data?.orders ?? [];
  if (orders.length === 0) return false;
  const estados = await Promise.all(
    orders.map(async (x) => (await mlGet(`/orders/${x.id}`, token)).data?.status)
  );
  return estados.every((s) => s === "cancelled");
}

// Reclamacoes (mediacoes) abertas do vendedor. Falha silenciosa: se a API
// recusar, a deteccao cai no status da conversa.
async function mlReclamacoesAbertas(token: string): Promise<any[]> {
  try {
    const r = await mlGet("/post-purchase/v1/claims/search?status=opened&limit=50", token);
    if (!r.ok) return [];
    return Array.isArray(r.data?.data) ? r.data.data : [];
  } catch {
    return [];
  }
}

// true se a conversa de pos-venda esta bloqueada por mediacao
async function mlConversaEmMediacao(pack: string, seller: string, token: string): Promise<boolean> {
  const r = await mlGet("/messages/packs/" + pack + "/sellers/" + seller + "?tag=post_sale&mark_as_read=false", token);
  if (!r.ok) return false;
  const st = r.data?.conversation_status;
  return String(st?.substatus ?? "").toLowerCase().includes("mediation");
}

export async function listarML(): Promise<ListaResultado> {
  const sessao = await getValidMLAccessToken();
  if (!sessao) return { conectado: false, conversas: [] };
  const { accessToken, userId } = sessao;
  const conversas: Conversa[] = [];
  let erro: string | undefined;

  // Perguntas: pendentes + ultimas respondidas
  for (const status of ["UNANSWERED", "ANSWERED"]) {
    const r = await mlGet(
      `/questions/search?seller_id=${userId}&status=${status}&sort_fields=date_created&sort_types=DESC&limit=${
        status === "UNANSWERED" ? 50 : 20
      }&api_version=4`,
      accessToken
    );
    if (!r.ok) {
      erro = `Perguntas ML: HTTP ${r.status}`;
      continue;
    }
    const qs: any[] = r.data?.questions ?? [];
    const titulos = await mlTitulos(
      qs.map((q) => String(q.item_id ?? "")),
      accessToken
    );
    for (const q of qs) {
      const item = titulos.get(String(q.item_id));
      conversas.push({
        id: `q:${q.id}`,
        plataforma: "ml",
        tipo: "pergunta",
        titulo: item?.title ?? String(q.item_id ?? "Anuncio"),
        comprador: q.from?.id ? `Cliente ${q.from.id}` : "Cliente",
        ultimaMensagem: q.answer?.text ?? q.text ?? "",
        data: q.answer?.date_created ?? q.date_created,
        naoLida: status === "UNANSWERED",
        thumbnail: item?.thumbnail ?? null,
        respondida: status === "ANSWERED",
      });
    }
  }

  const reclamacoes = await mlReclamacoesAbertas(accessToken);
  const usados = new Set<string>();

  // Pos-venda: conversas com mensagens nao lidas
  const un = await mlGet(`/messages/unread?role=seller&tag=post_sale`, accessToken);
  if (un.ok) {
    const results: any[] = un.data?.results ?? [];
    for (const res of results) {
      const m = /packs\/(\d+)\/sellers\/(\d+)/.exec(String(res?.resource ?? ""));
      if (!m) continue;
      const cancelada = await mlPedidoCancelado(m[1], accessToken);
      const reclamacao = reclamacoes.find((c) => String(c.resource_id) === m[1]);
      const mediacao = !cancelada && (!!reclamacao || (await mlConversaEmMediacao(m[1], m[2], accessToken)));
      if (mediacao) {
        usados.add(m[1]);
        conversas.push({
          id: "p:" + m[1] + "/" + m[2],
          plataforma: "ml",
          tipo: "posvenda",
          titulo: "Mediacao - pedido " + m[1],
          comprador: "Comprador",
          ultimaMensagem: "Em mediacao - responda pela reclamacao no ML",
          data: new Date().toISOString(),
          naoLida: true,
          mediacao: true,
        });
        continue;
      }
      conversas.push({
        id: `p:${m[1]}/${m[2]}`,
        plataforma: "ml",
        tipo: "posvenda",
        titulo: `Pos-venda - pedido ${m[1]}${cancelada ? " (cancelado)" : ""}`,
        comprador: "Comprador",
        ultimaMensagem: cancelada
          ? "Pedido cancelado - ML nao permite responder"
          : `${res?.count ?? 1} mensagem(ns) nao lida(s)`,
        data: new Date().toISOString(),
        naoLida: !cancelada,
        cancelada,
      });
    }
  } else {
    erro = (erro ? erro + " | " : "") + `Pos-venda ML: HTTP ${un.status}`;
  }

  // Reclamacoes abertas que nao apareceram na lista de nao lidas
  for (const rc of reclamacoes) {
    const pedido = String(rc.resource_id ?? "");
    if (!pedido || usados.has(pedido)) continue;
    usados.add(pedido);
    conversas.push({
      id: "p:" + pedido + "/" + userId,
      plataforma: "ml",
      tipo: "posvenda",
      titulo: "Mediacao - pedido " + pedido,
      comprador: "Comprador",
      ultimaMensagem: "Reclamacao aberta - responda pelo ML",
      data: rc.last_updated ?? rc.date_created ?? new Date().toISOString(),
      naoLida: true,
      mediacao: true,
    });
  }

  conversas.sort((a, b) => (a.data < b.data ? 1 : -1));
  return { conectado: true, erro, conversas };
}

export async function threadML(id: string): Promise<ThreadResultado> {
  const sessao = await getValidMLAccessToken();
  if (!sessao) return { conectado: false, mensagens: [] };
  const { accessToken, userId } = sessao;

  if (id.startsWith("q:")) {
    const qid = id.slice(2);
    const r = await mlGet(`/questions/${qid}?api_version=4`, accessToken);
    if (!r.ok) return { conectado: true, erro: `HTTP ${r.status}`, mensagens: [] };
    const q = r.data;
    const msgs: Mensagem[] = [
      { id: `q${q.id}`, de: "cliente", texto: q.text ?? "", data: q.date_created },
    ];
    if (q.answer?.text) {
      msgs.push({ id: `a${q.id}`, de: "loja", texto: q.answer.text, data: q.answer.date_created });
    }
    const t = await mlTitulos([String(q.item_id ?? "")], accessToken);
    return {
      conectado: true,
      mensagens: msgs,
      contexto: t.get(String(q.item_id))?.title ?? String(q.item_id ?? ""),
    };
  }

  if (id.startsWith("p:")) {
    const [pack, seller] = id.slice(2).split("/");
    const r = await mlGet(
      `/messages/packs/${pack}/sellers/${seller}?tag=post_sale&mark_as_read=false`,
      accessToken
    );
    if (!r.ok) return { conectado: true, erro: `HTTP ${r.status}`, mensagens: [] };
    const lista: any[] = r.data?.messages ?? [];
    const msgs: Mensagem[] = lista
      .map((m) => ({
        id: String(m.id),
        de: (String(m.from?.user_id) === String(userId) ? "loja" : "cliente") as "loja" | "cliente",
        texto: typeof m.text === "string" ? m.text : m.text?.plain ?? "",
        data: m.message_date?.created ?? m.message_date?.received ?? new Date().toISOString(),
      }))
      .sort((a, b) => (a.data < b.data ? -1 : 1));
    return { conectado: true, mensagens: msgs, contexto: `Pedido/pacote ${pack}` };
  }

  return { conectado: true, erro: "id invalido", mensagens: [] };
}

export async function responderML(id: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const sessao = await getValidMLAccessToken();
  if (!sessao) return { ok: false, erro: "ML desconectado" };
  const { accessToken, userId } = sessao;

  if (id.startsWith("q:")) {
    const resp = await fetch(`${ML_API_BASE}/answers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: Number(id.slice(2)), text: texto }),
    });
    if (!resp.ok) return { ok: false, erro: `ML ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    return { ok: true };
  }

  if (id.startsWith("p:")) {
    const [pack, seller] = id.slice(2).split("/");
    if (await mlConversaEmMediacao(pack, seller, accessToken)) {
      return { ok: false, erro: "Pedido em mediacao: o ML bloqueia o chat. Responda pela reclamacao no painel do ML." };
    }
    // descobre o id do comprador pela propria conversa
    const r = await mlGet(`/messages/packs/${pack}/sellers/${seller}?tag=post_sale&mark_as_read=false`, accessToken);
    const msgs: any[] = r.data?.messages ?? [];
    const doCliente = msgs.find((m) => String(m.from?.user_id) !== String(userId));
    const buyerId = doCliente?.from?.user_id ?? r.data?.conversation_status?.buyer_id;
    if (!buyerId) return { ok: false, erro: "Nao foi possivel identificar o comprador" };
    const resp = await fetch(`${ML_API_BASE}/messages/packs/${pack}/sellers/${seller}?tag=post_sale`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: { user_id: Number(userId) }, to: { user_id: Number(buyerId) }, text: texto }),
    });
    if (!resp.ok) return { ok: false, erro: `ML ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    return { ok: true };
  }
  return { ok: false, erro: "id invalido" };
}

// ------------------------------------------------------------ Shopee

async function sessaoShopee(): Promise<{ accessToken: string; shopId: number } | null> {
  // Sessao no banco (auto-refresh), igual lib/shopee-orders.ts
  return getValidShopeeAccessToken();
}

function shopeeErro(data: any): string | undefined {
  if (data?.error) return `${data.error}${data.message ? ": " + data.message : ""}`;
  return undefined;
}

function nsParaIso(v: any): string {
  const n = Number(v);
  if (!n) return new Date().toISOString();
  // a Shopee manda nanosegundos em alguns campos e segundos em outros
  const ms = n > 1e15 ? n / 1e6 : n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

export async function listarShopee(): Promise<ListaResultado> {
  const s = await sessaoShopee();
  if (!s) return { conectado: false, conversas: [] };
  const url = new URL(signAuthenticatedRequest("/api/v2/sellerchat/get_conversation_list", s.accessToken, s.shopId));
  url.searchParams.set("direction", "latest");
  url.searchParams.set("type", "all");
  url.searchParams.set("page_size", "30");
  try {
    const resp = await fetch(url.toString(), { cache: "no-store" });
    const data = await resp.json();
    const e = shopeeErro(data);
    if (e) return { conectado: true, erro: `Shopee Chat: ${e}`, conversas: [] };
    const lista: any[] = data?.response?.conversations ?? [];
    const conversas: Conversa[] = lista.map((c) => {
      const content = c.latest_message_content ?? {};
      const texto =
        c.latest_message_type === "text"
          ? content.text ?? ""
          : `[${c.latest_message_type ?? "mensagem"}]`;
      return {
        id: `s:${c.conversation_id}`,
        plataforma: "shopee" as const,
        tipo: "chat" as const,
        titulo: c.to_name ?? "Comprador",
        comprador: c.to_name ?? "Comprador",
        ultimaMensagem: texto,
        data: nsParaIso(c.last_message_timestamp),
        naoLida: Number(c.unread_count ?? 0) > 0,
      };
    });
    return { conectado: true, conversas };
  } catch (err) {
    return { conectado: true, erro: `Shopee Chat: ${String(err)}`, conversas: [] };
  }
}

export async function threadShopee(id: string): Promise<ThreadResultado> {
  const s = await sessaoShopee();
  if (!s) return { conectado: false, mensagens: [] };
  const conversationId = id.replace(/^s:/, "");
  const url = new URL(signAuthenticatedRequest("/api/v2/sellerchat/get_message", s.accessToken, s.shopId));
  url.searchParams.set("conversation_id", conversationId);
  url.searchParams.set("page_size", "40");
  try {
    const resp = await fetch(url.toString(), { cache: "no-store" });
    const data = await resp.json();
    const e = shopeeErro(data);
    if (e) return { conectado: true, erro: `Shopee Chat: ${e}`, mensagens: [] };
    const lista: any[] = data?.response?.messages ?? [];
    const msgs: Mensagem[] = lista
      .map((m) => ({
        id: String(m.message_id),
        de: (Number(m.from_shop_id) === s.shopId || String(m.from_id) === String(s.shopId)
          ? "loja"
          : "cliente") as "loja" | "cliente",
        texto:
          m.message_type === "text"
            ? m.content?.text ?? ""
            : `[${m.message_type ?? "anexo"}]`,
        data: nsParaIso(m.created_timestamp),
      }))
      .sort((a, b) => (a.data < b.data ? -1 : 1));
    return { conectado: true, mensagens: msgs };
  } catch (err) {
    return { conectado: true, erro: String(err), mensagens: [] };
  }
}

export async function responderShopee(id: string, texto: string): Promise<{ ok: boolean; erro?: string }> {
  const s = await sessaoShopee();
  if (!s) return { ok: false, erro: "Shopee desconectada" };
  const conversationId = id.replace(/^s:/, "");

  // precisa do to_id (id do comprador) -> pega da conversa
  const one = new URL(signAuthenticatedRequest("/api/v2/sellerchat/get_one_conversation", s.accessToken, s.shopId));
  one.searchParams.set("conversation_id", conversationId);
  try {
    const r1 = await fetch(one.toString(), { cache: "no-store" });
    const d1 = await r1.json();
    const e1 = shopeeErro(d1);
    if (e1) return { ok: false, erro: e1 };
    const toId = d1?.response?.to_id;
    if (!toId) return { ok: false, erro: "Nao foi possivel identificar o comprador" };

    const send = signAuthenticatedRequest("/api/v2/sellerchat/send_message", s.accessToken, s.shopId);
    const r2 = await fetch(send, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to_id: toId, message_type: "text", content: { text: texto } }),
    });
    const d2 = await r2.json();
    const e2 = shopeeErro(d2);
    if (e2) return { ok: false, erro: e2 };
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}
