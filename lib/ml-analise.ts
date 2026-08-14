// Aba Analise - pedido do Guilherme em 2026-08-11: "montar uma nova aba
// de Analise (por enquanto so do Mercado Livre) que puxe a quantidade de
// anuncios que tem na conta, data de criacao desses anuncios, e dias sem
// vendas". Reaproveita o access_token do ML ja salvo em cookie (mesmo
// fluxo de conexao usado em Vendas/Full) e a tabela pedidos_cache (ja
// mantida por lib/pedidos-cache.ts) pra achar a ultima venda de cada
// anuncio sem precisar bater na API de pedidos de novo.
//
// Atualizado em 2026-08-11 (2a mensagem): o Guilherme apontou que a conta
// tem 37 anuncios reais, mas a versao anterior mostrava 114 linhas - uma
// por item_id (cada cor/variacao tem seu proprio item_id na ML). Primeira
// tentativa de correcao agrupou por user_product_id (campo que a ML usa
// oficialmente pra "isso e o mesmo produto em cores diferentes").
//
// Atualizado em 2026-08-11 (3a mensagem): essa tentativa tambem deu
// errado (voltou 113 "anuncios" - quase igual a antes). Motivo: o
// Guilherme cadastra cada cor como um anuncio publicado separadamente
// (nao usa o fluxo nativo de variacao da ML), entao user_product_id nao
// vem compartilhado entre eles - cada item cai sozinho no proprio grupo.
// Confirmado com o Guilherme que o agrupamento certo e "por sku": reusa
// o MESMO casamento texto/SKU->placa ja usado e testado em
// lib/demanda.ts (matchItemToPlacaIds, o mesmo motor por tras da aba
// Full e da fila de producao) pra achar a qual produto do catalogo cada
// anuncio da ML pertence, e agrupa pelo NOME do produto sem a cor (ex:
// "Suporte Box 6mm (kit 1/2/3) (Preto)" e "(Branco)" -> mesmo grupo
// "Suporte Box 6mm (kit 1/2/3)"). "Com Parafuso" x "Sem Parafuso" tambem
// entram no mesmo grupo quando o catalogo os trata como o mesmo produto -
// o "+" de expandir continua mostrando cada SKU/variacao real
// individualmente, entao nenhum detalhe se perde mesmo agrupando mais.
// Anuncios que nao batem com nenhum produto do catalogo (nao cadastrado
// ainda, ou texto nao reconhecido) caem sozinhos no proprio grupo, como
// fallback - melhor mostrar separado do que juntar errado.
import { getValidMLAccessToken } from "./ml-auth";
import { sql } from "./db";
import { ML_API_BASE } from "./mercadolivre";
import { DbPlacaRow, toPlacaRow, PlacaRow } from "./placas";
import { matchItemToPlacaIds, SkuPlacaMap } from "./demanda";

export interface AnuncioAnalise {
    itemId: string;
    title: string;
    sku: string;
    hasCustomSku: boolean;
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

// Catalogo de produtos (placas) + mapa SKU->placa, mesma consulta usada
// em app/api/estoque-full/route.ts - e o que da a matchItemToPlacaIds
// (lib/demanda.ts) o material pra reconhecer qual produto real do
// catalogo cada anuncio da ML representa.
async function buscarCatalogo(): Promise<{ placas: PlacaRow[]; skuPlacaMap: SkuPlacaMap }> {
    // Só precisamos do texto (nome/sku_ou_kit/frases) pra casar com o
  // título/SKU do anúncio - "0 AS estoque" só existe pra bater com o
  // formato esperado por toPlacaRow (não usamos estoque aqui).
  const placaRows = (await sql`
      SELECT
            id, numero, nome, tipo, papel, grupo_composto,
                  sku_ou_kit, frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
                        descontinuada, 0 AS estoque
                            FROM placas
                                WHERE descontinuada = false
                                    ORDER BY numero ASC
                                      `) as DbPlacaRow[];
    const placas = placaRows.map(toPlacaRow);

  const skuPlacaRows = (await sql`
      SELECT sku, placa_id, pecas_por_unidade FROM sku_placa
        `) as { sku: string; placa_id: number; pecas_por_unidade: string }[];
    const skuPlacaMap: SkuPlacaMap = new Map();
    for (const row of skuPlacaRows) {
          const chave = row.sku
            .toLowerCase()
            .normalize("NFD")
            .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
          const lista = skuPlacaMap.get(chave) ?? [];
          lista.push({ placaId: row.placa_id, pecasPorUnidade: Number(row.pecas_por_unidade) });
          skuPlacaMap.set(chave, lista);
    }

  return { placas, skuPlacaMap };
}

// Convencao usada em todo o catalogo: "Nome Do Produto (Cor)" - tira só
// o ultimo parenteses (a cor), preservando o resto do nome (ex: mantem
// "(kit 1/2/3)" em "Suporte Box 6mm (kit 1/2/3) (Preto)").
function nomeBaseDoProduto(nomePlaca: string): string {
    const semCor = nomePlaca.replace(/\s*\([^)]*\)\s*$/, "").trim();
    return semCor || nomePlaca;
}

function chaveOrdenacao(diasSemVenda: number | null, diasDesdeCriacao: number): number {
    return diasSemVenda === null ? diasDesdeCriacao + 1_000_000 : diasSemVenda;
}

export async function getAnaliseAnuncios(): Promise<AnaliseResult> {
        const auth = await getValidMLAccessToken();
        if (!auth) return { connected: false };
        const { accessToken, userId } = auth;

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

  const [detalhes, vendasPorItem, { placas, skuPlacaMap }] = await Promise.all([
        buscarDetalhesItens(itemIds, accessToken),
        ultimaVendaPorItem(),
        buscarCatalogo(),
      ]);

  const agora = new Date().toISOString();
    const anuncios: AnuncioAnalise[] = detalhes.map((it) => {
          const ultimaVenda = vendasPorItem.get(it.id) ?? null;
          return {
                  itemId: it.id,
                  title: it.title ?? "-",
                  sku: it.seller_custom_field ?? "-",
                  hasCustomSku: Boolean(it.seller_custom_field),
                  permalink: it.permalink ?? "",
                  dateCreated: it.date_created ?? null,
                  diasDesdeCriacao: it.date_created ? diasEntre(it.date_created, agora) : 0,
                  ultimaVendaEm: ultimaVenda,
                  diasSemVenda: ultimaVenda ? diasEntre(ultimaVenda, agora) : null,
          };
    });

  // Agrupa por produto do catalogo (via o mesmo casamento texto/SKU já
  // usado na aba Full), ignorando a cor. Sem match nenhum -> fica
  // sozinho no próprio grupo (usa o próprio itemId como chave), em vez
  // de arriscar juntar com algo errado.
  const gruposMap = new Map<string, { titulo: string; variacoes: AnuncioAnalise[] }>();
    for (const a of anuncios) {
          const placaIds = matchItemToPlacaIds(
            { sku: a.hasCustomSku ? a.sku : "", hasCustomSku: a.hasCustomSku, title: a.title },
                  placas,
                  skuPlacaMap
                );
          let chave: string;
          let tituloGrupo: string;
          if (placaIds.length > 0) {
                  const placa = placas.find((p) => p.id === placaIds[0]);
                  const nomeBase = placa ? nomeBaseDoProduto(placa.nome) : a.title;
                  chave = `produto:${nomeBase.toLowerCase()}`;
                  tituloGrupo = nomeBase;
          } else {
                  chave = `item:${a.itemId}`;
                  tituloGrupo = a.title;
          }
          const existente = gruposMap.get(chave);
          if (existente) {
                  existente.variacoes.push(a);
          } else {
                  gruposMap.set(chave, { titulo: tituloGrupo, variacoes: [a] });
          }
    }

  const grupos: GrupoAnaliseAnuncio[] = Array.from(gruposMap.entries()).map(
        ([chave, { titulo, variacoes: variacoesBrutas }]) => {
                const variacoes = [...variacoesBrutas].sort(
                          (a, b) =>
                                      chaveOrdenacao(b.diasSemVenda, b.diasDesdeCriacao) -
                                      chaveOrdenacao(a.diasSemVenda, a.diasDesdeCriacao)
                        );

          const ordenadasPorCriacao = [...variacoesBrutas].sort((a, b) =>
                    (a.dateCreated ?? "").localeCompare(b.dateCreated ?? "")
                                                                      );
                const dateCreatedMaisAntiga = ordenadasPorCriacao[0]?.dateCreated ?? null;

          const vendasDoGrupo = variacoesBrutas
                  .map((v) => v.ultimaVendaEm)
                  .filter((v): v is string => Boolean(v));
                const ultimaVendaEm =
                          vendasDoGrupo.length > 0
                    ? vendasDoGrupo.reduce((max, v) => (v > max ? v : max))
                            : null;

          return {
                    chave,
                    titulo,
                    totalVariacoes: variacoesBrutas.length,
                    dateCreatedMaisAntiga,
                    diasDesdeCriacaoGrupo: dateCreatedMaisAntiga ? diasEntre(dateCreatedMaisAntiga, agora) : 0,
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
