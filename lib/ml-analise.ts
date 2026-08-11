// Aba Analise - pedido do Guilherme em 2026-08-11: "montar uma nova aba
// de Analise (por enquanto so do Mercado Livre) que puxe a quantidade de
// anuncios que tem na conta, data de criacao desses anuncios, e dias sem
// vendas". Reaproveita o access_token do ML ja salvo em cookie (mesmo
// fluxo de conexao usado em Vendas/Full) e a tabela pedidos_cache (ja
// mantida por lib/pedidos-cache.ts) pra achar a ultima venda de cada
// anuncio sem precisar bater na API de pedidos de novo.
//
// Atualizado em 2026-08-11 (2a mensagem): o Guilherme apontou que a conta
// tem 37 anuncios reais, mas a versao anterior mostrava 114 linhas - cada
// variacao (cor, kit 1/2/3 etc) tem seu proprio item_id na API da ML,
// entao vinha uma linha por item_id em vez de uma por anuncio. A ML
// expõe um agrupador real pra isso: user_product_id (o mesmo campo ja
// usado em lib/mercadolivre.ts pra ler o estoque Full) - varios item_id
// que sao variacoes do mesmo produto compartilham o mesmo
// user_product_id. Agora agrupamos por esse campo: 1 linha por anuncio
// (user_product_id), com um "+" pra expandir e ver cada SKU/variacao
// individualmente (e qual delas especificamente parou de vender).
import { cookies } from "next/headers";
import { sql } from "./db";
import { ML_API_BASE } from "./mercadolivre";

export interface AnuncioAnalise {
  itemId: string;
  title: string;
  sku: string;
  permalink: string;
  dateCreated: string | null;
  diasDesdeCriacao: number;
  ultimaVendaEm: string | null;
  diasSemVenda: number | null;
}

export interface GrupoAnaliseAnuncio {
  chave: string;
  titulo: string;
  totalVariacoes: number;
  dateCreatedMaisAntiga: string | null;
  diasDesdeCriacaoGrupo: number;
  ultimaVendaEm: string | null;
  diasSemVenda: number | null;
  variacoes: AnuncioAnalise[];
}

export type AnaliseResult =
  | { connected: false }
| { connected: true; error: true }
| {
  connected: true;
  error: false;
  totalAnuncios: number;
  totalVariacoes: number;
  grupos: GrupoAnaliseAnuncio[];
};

function diasEntre(deIso: string, ateIso: string): number {
  const diffMs = new Date(ateIso).getTime() - new Date(deIso).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

async function buscarTodosItemIds(userId: string, accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const resp = await fetch(
      `${ML_API_BASE}/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
    if (!resp.ok) throw new Error(`items/search respondeu ${resp.status}`);
    const data = await resp.json();
    const results: string[] = data?.results ?? [];
    ids.push(...results);
    const total: number = data?.paging?.total ?? results.length;
    offset += limit;
    if (results.length === 0 || offset >= total || offset >= 1000) break;
  }
  return ids;
}

interface MLItemFull {
  id: string;
  title?: string;
  seller_custom_field?: string;
  date_created?: string;
  permalink?: string;
}

async function buscarDetalhesItens(ids: string[], accessToken: string): Promise<MLItemFull[]> {
  const out: MLItemFull[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    try {
      const resp = await fetch(
        `${ML_API_BASE}/items?ids=${batch.join(",")}&attributes=id,title,seller_custom_field,date_created,permalink`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
        );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const entry of data ?? []) {
        if (entry?.code === 200 && entry.body?.id) out.push(entry.body);
      }
    } catch {}
  }
  return out;
}

async function buscarUserProductIds(ids: string[], accessToken: string): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (itemId) => {
      try {
        const resp = await fetch(`${ML_API_BASE}/items/${itemId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!resp.ok) { map.set(itemId, null); return; }
        const data = await resp.json();
        map.set(itemId, data?.user_product_id ?? null);
      } catch {
        map.set(itemId, null);
      }
    })
    );
  return map;
}

async function ultimaVendaPorItem(): Promise<Map<string, string>> {
  const rows = (await sql`
  SELECT item->>'itemId' AS item_id, MAX(data_criado)::text AS ultima_venda
  FROM pedidos_cache, jsonb_array_elements(itens) AS item
  WHERE plataforma = 'ml' AND item->>'itemId' IS NOT NULL
  GROUP BY item->>'itemId'
  `) as { item_id: string; ultima_venda: string }[];
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.item_id, r.ultima_venda);
  return map;
}

function chaveOrdenacao(diasSemVenda: number | null, diasDesdeCriacao: number): number {
  return diasSemVenda === null ? diasDesdeCriacao + 1_000_000 : diasSemVenda;
}

export async function getAnaliseAnuncios(): Promise<AnaliseResult> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;
  if (!accessToken || !userId) return { connected: false };

let itemIds: string[];
  try {
    itemIds = await buscarTodosItemIds(userId, accessToken);
  } catch (err) {
    console.error("[analise] erro ao listar anuncios:", err);
    return { connected: true, error: true };
  }

if (itemIds.length === 0) {
  return { connected: true, error: false, totalAnuncios: 0, totalVariacoes: 0, grupos: [] };
}

const [detalhes, vendasPorItem, userProductIds] = await Promise.all([
  buscarDetalhesItens(itemIds, accessToken),
  ultimaVendaPorItem(),
  buscarUserProductIds(itemIds, accessToken),
  ]);

const agora = new Date().toISOString();
  const anuncios: AnuncioAnalise[] = detalhes.map((it) => {
    const ultimaVenda = vendasPorItem.get(it.id) ?? null;
    return {
      itemId: it.id,
      title: it.title ?? "-",
      sku: it.seller_custom_field ?? "-",
      permalink: it.permalink ?? "",
      dateCreated: it.date_created ?? null,
      diasDesdeCriacao: it.date_created ? diasEntre(it.date_created, agora) : 0,
      ultimaVendaEm: ultimaVenda,
      diasSemVenda: ultimaVenda ? diasEntre(ultimaVenda, agora) : null,
    };
  });

const gruposMap = new Map<string, AnuncioAnalise[]>();
  for (const a of anuncios) {
    const chave = userProductIds.get(a.itemId) || a.itemId;
    const lista = gruposMap.get(chave) ?? [];
    lista.push(a);
    gruposMap.set(chave, lista);
  }

const grupos: GrupoAnaliseAnuncio[] = Array.from(gruposMap.entries()).map(
  ([chave, variacoesBrutas]) => {
    const variacoes = [...variacoesBrutas].sort(
      (a, b) => chaveOrdenacao(b.diasSemVenda, b.diasDesdeCriacao) -
        chaveOrdenacao(a.diasSemVenda, a.diasDesdeCriacao)
      );

  const ordenadasPorCriacao = [...variacoesBrutas].sort((a, b) =>
    (a.dateCreated ?? "").localeCompare(b.dateCreated ?? "")
                                                        );
    const maisAntiga = ordenadasPorCriacao[0];
    const dateCreatedMaisAntiga = maisAntiga?.dateCreated ?? null;

  const vendasDoGrupo = variacoesBrutas
    .map((v) => v.ultimaVendaEm)
    .filter((v): v is string => Boolean(v));
    const ultimaVendaEm =
      vendasDoGrupo.length > 0
    ? vendasDoGrupo.reduce((max, v) => (v > max ? v : max))
      : null;

  return {
    chave,
    titulo: maisAntiga?.title ?? variacoesBrutas[0].title,
    totalVariacoes: variacoesBrutas.length,
    dateCreatedMaisAntiga,
    diasDesdeCriacaoGrupo: dateCreatedMaisAntiga
    ? diasEntre(dateCreatedMaisAntiga, agora)
      : 0,
    ultimaVendaEm,
    diasSemVenda: ultimaVendaEm ? diasEntre(ultimaVendaEm, agora) : null,
    variacoes,
  };
  }
  );

grupos.sort(
  (a, b) =>
    chaveOrdenacao(b.diasSemVenda, b.diasDesdeCriacaoGrupo) -
    chaveOrdenacao(a.diasSemVenda, a.diasDesdeCriacaoGrupo)
  );

return {
  connected: true,
  error: false,
  totalAnuncios: grupos.length,
  totalVariacoes: anuncios.length,
  grupos,
};
}
