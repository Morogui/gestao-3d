// Aba Análise — pedido do Guilherme em 2026-08-11: "montar uma nova aba
// de Análise (por enquanto só do Mercado Livre) que puxe a quantidade de
// anúncios que tem na conta, data de criação desses anúncios, e dias sem
// vendas". Reaproveita o access_token do ML já salvo em cookie (mesmo
// fluxo de conexão usado em Vendas/Full) e a tabela pedidos_cache (já
// mantida por lib/pedidos-cache.ts) pra achar a última venda de cada
// anúncio sem precisar bater na API de pedidos de novo.
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
  ultimaVendaEm: string | null; // null = nunca vendeu
diasSemVenda: number | null; // null = nunca vendeu (usar diasDesdeCriacao)
}

export type AnaliseResult =
  | { connected: false }
| { connected: true; error: true }
| {
  connected: true;
  error: false;
  totalAnuncios: number;
  anuncios: AnuncioAnalise[];
};

function diasEntre(deIso: string, ateIso: string): number {
  const diffMs = new Date(ateIso).getTime() - new Date(deIso).getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

// Busca todos os item_id ativos do vendedor via paginação por offset.
// A API da ML trava esse tipo de paginação em 1000 resultados — mais que
// isso exigiria o modo "scan" (search_type=scan + scroll_id), o que não
// deve ser necessário pro tamanho atual do catálogo.
async function buscarTodosItemIds(
  userId: string,
  accessToken: string
  ): Promise<string[]> {
  const ids: string[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const resp = await fetch(
      `${ML_API_BASE}/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
    if (!resp.ok) {
      throw new Error(`items/search respondeu ${resp.status}`);
    }
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

// Multiget /items?ids=... (até 20 ids por chamada) — mesmo padrão já
// usado em lib/ml-orders.ts (fetchItemDetails), só que pedindo também
// date_created e permalink em vez de thumbnail.
async function buscarDetalhesItens(
  ids: string[],
  accessToken: string
  ): Promise<MLItemFull[]> {
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
    } catch {
      // uma leva falhar não derruba as outras
    }
  }
  return out;
}

// Última data de venda de cada item_id, direto do registro local de
// pedidos (pedidos_cache.itens é um array JSONB de OrderItemSummary —
// cada elemento tem a chave "itemId"). Evita bater na API de pedidos de
// novo: essa tabela já é mantida em quase tempo real por
// sincronizarPedidos() (lib/pedidos-cache.ts).
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

export async function getAnaliseAnuncios(): Promise<AnaliseResult> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;
  if (!accessToken || !userId) return { connected: false };

let itemIds: string[];
  try {
    itemIds = await buscarTodosItemIds(userId, accessToken);
  } catch (err) {
    console.error("[analise] erro ao listar anúncios:", err);
    return { connected: true, error: true };
  }

if (itemIds.length === 0) {
  return { connected: true, error: false, totalAnuncios: 0, anuncios: [] };
}

const [detalhes, vendasPorItem] = await Promise.all([
  buscarDetalhesItens(itemIds, accessToken),
  ultimaVendaPorItem(),
  ]);

const agora = new Date().toISOString();
  const anuncios: AnuncioAnalise[] = detalhes.map((it) => {
    const ultimaVenda = vendasPorItem.get(it.id) ?? null;
    return {
      itemId: it.id,
      title: it.title ?? "—",
      sku: it.seller_custom_field ?? "—",
      permalink: it.permalink ?? "",
      dateCreated: it.date_created ?? null,
      diasDesdeCriacao: it.date_created ? diasEntre(it.date_created, agora) : 0,
      ultimaVendaEm: ultimaVenda,
      diasSemVenda: ultimaVenda ? diasEntre(ultimaVenda, agora) : null,
    };
  });

// Ordena do mais preocupante pro menos: nunca vendeu (usando dias desde
// a criação como critério) primeiro, depois por dias sem venda desc.
anuncios.sort((a, b) => {
  const chave = (x: AnuncioAnalise) =>
    x.diasSemVenda === null ? x.diasDesdeCriacao + 1000000 : x.diasSemVenda;
  return chave(b) - chave(a);
});

return {
  connected: true,
  error: false,
  totalAnuncios: anuncios.length,
  anuncios,
};
}
