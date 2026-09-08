// Registro local de pedidos (tabela pedidos_cache) — pedido do Guilherme
// em 2026-07-24: "para a nossa produção não ficar tão dependente de API,
// abra um registro de atualização de pedidos e consulte esse registro de
// 1 em 1 minuto, e com isso usamos essa base para fazer consulta de
// produção e mostrar as vendas quase em tempo real".
//
// Antes desse arquivo, TODA visualização (Vendas, Produção/demanda,
// Estoque/baixa automática) chamava a API da ML e da Shopee AO VIVO toda
// vez que alguém abria a tela — cada pedido custava chamadas extras
// (foto do item, status do envio), então abrir a aba Vendas ou Produção
// várias vezes por dia significava repetir esse custo inteiro sempre.
//
// A partir de agora existe UMA única fonte que efetivamente conversa com
// a ML/Shopee ao vivo: sincronizarPedidos() (chamada pelo cron em
// /api/pedidos/sincronizar, 1 em 1 minuto, e também pela sincronização de
// estoque). Ela grava o resultado em pedidos_cache. Todo o resto (Vendas,
// Produção, o próprio cálculo de baixa de estoque) passa a LER dessa
// tabela — os nomes das funções abaixo (getOrdersRangeML, getOrdersRangeShopee,
// getDailyTotalsRangeML, getDailyTotalsRangeShopee) têm exatamente a mesma
// assinatura e formato de retorno das funções equivalentes em
// lib/ml-orders.ts / lib/shopee-orders.ts de propósito — trocar a fonte de
// dados em qualquer tela é só trocar de onde vem o import, sem mexer no
// resto da lógica (pedidoFoiVendido, calcularDemandaSemanal, resumoStats
// etc. continuam recebendo o mesmíssimo formato OrderSummary[]).
import { cookies } from "next/headers";
import { sql } from "./db";
import {
    getOrdersRange as getOrdersRangeMLAoVivo,
    OrderItemSummary,
    OrderSummary,
    OrdersResult,
    DiaTotal,
    DailyTotalsResult,
} from "./ml-orders";
import { getOrdersRange as getOrdersRangeShopeeAoVivo } from "./shopee-orders";
import { todaySP, diasAtras } from "./date";

type Plataforma = "ml" | "shopee";

function mlConectado(): boolean {
    const c = cookies();
    return Boolean(c.get("ml_access_token")?.value && c.get("ml_user_id")?.value);
}

function shopeeConectado(): boolean {
    const c = cookies();
    return Boolean(c.get("shopee_shop_id")?.value);
}

async function garantirTabelaStatusSync() {
    await sql`
        CREATE TABLE IF NOT EXISTS sync_status (
              plataforma TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                          atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                              )
                                `;
}

async function gravarStatusSync(plataforma: Plataforma, status: "ok" | "erro") {
    await garantirTabelaStatusSync();
    await sql`
        INSERT INTO sync_status (plataforma, status, atualizado_em)
            VALUES (${plataforma}, ${status}, now())
                ON CONFLICT (plataforma) DO UPDATE SET
                      status = EXCLUDED.status,
                            atualizado_em = now()
                              `;
}

async function statusSyncPersistido(plataforma: Plataforma): Promise<"ok" | "erro" | null> {
    await garantirTabelaStatusSync();
    const rows = (await sql`
        SELECT status FROM sync_status WHERE plataforma = ${plataforma}
          `) as { status: string }[];
    if (rows.length === 0) return null;
    return rows[0].status === "erro" ? "erro" : "ok";
}

interface PedidoCacheRow {
    plataforma: Plataforma;
    pedido_id: string;
    data_criado: string;
    buyer_nickname: string | null;
    itens: OrderItemSummary[];
    total_amount: string;
    status: string | null;
    shipping_mode: string | null;
    shipping_status: string | null;
}

function rowToOrder(row: PedidoCacheRow): OrderSummary {
    return {
          id: row.plataforma === "ml" ? Number(row.pedido_id) : row.pedido_id,
          dateCreated: row.data_criado,
          buyerNickname: row.buyer_nickname ?? "—",
          items: row.itens ?? [],
          totalAmount: Number(row.total_amount),
          status: row.status ?? "—",
          shippingMode: row.shipping_mode ?? "—",
          shippingStatus: row.shipping_status ?? "—",
          plataforma: row.plataforma,
    };
}

async function queryRange(
    fromDay: string,
    toDay: string,
    plataforma: Plataforma
  ): Promise<OrderSummary[]> {
    const rows = (await sql`
        SELECT plataforma, pedido_id, data_criado, buyer_nickname, itens,
                   total_amount, status, shipping_mode, shipping_status
                       FROM pedidos_cache
                           WHERE plataforma = ${plataforma}
                                 AND data_criado >= (${fromDay}::date)
                                       AND data_criado < ((${toDay}::date) + INTERVAL '1 day')
                                           ORDER BY data_criado DESC
                                             `) as PedidoCacheRow[];
    return rows.map(rowToOrder);
}

// Devolve TODOS os pedidos do período (inclusive cancelados) — a tela de
// Pedidos precisa continuar mostrando que eles existiram; quem soma
// faturamento/ranking/recorde é que precisa excluir (ver pedidoCancelado()
// em app/vendas/page.tsx e dailyTotals() abaixo).
export async function getOrdersRangeML(
    fromDay: string,
    toDay: string
  ): Promise<OrdersResult> {
    if (!mlConectado()) return { connected: false };
    if ((await statusSyncPersistido("ml")) === "erro") return { connected: true, error: true };
    const orders = await queryRange(fromDay, toDay, "ml");
    return { connected: true, error: false, orders };
}

export async function getOrdersRangeShopee(
    fromDay: string,
    toDay: string
  ): Promise<OrdersResult> {
    if (!shopeeConectado()) return { connected: false };
    if ((await statusSyncPersistido("shopee")) === "erro") return { connected: true, error: true };
    const orders = await queryRange(fromDay, toDay, "shopee");
    return { connected: true, error: false, orders };
}

// Pedido do Guilherme em 2026-09-08: "o valor novamente não está batendo,
// provavelmente você não está separando os cancelados" — pedidos
// cancelados (ML: "cancelled"/"invalidated"; Shopee: "CANCELLED"/
// "IN_CANCEL", cancelamento em andamento que não vai virar venda de
// verdade) nunca geram receita real, então dailyTotals() — que alimenta o
// "Recorde da loja (90 dias)" — precisa excluí-los na própria consulta,
// senão o melhor dia/soma fica maior do que o que realmente vendeu.
async function dailyTotals(
    fromDay: string,
    toDay: string,
    plataforma: Plataforma
  ): Promise<DiaTotal[]> {
    const rows = (
          plataforma === "ml"
            ? await sql`
                      SELECT
                                  (data_criado AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
                                              COALESCE(SUM(total_amount), 0)::float8 AS faturamento,
                                                          COUNT(*)::int AS pedidos
                                                                    FROM pedidos_cache
                                                                              WHERE plataforma = 'ml'
                                                                                          AND data_criado >= (${fromDay}::date)
                                                                                                      AND data_criado < ((${toDay}::date) + INTERVAL '1 day')
                                                                                                                  AND (status IS NULL OR status NOT IN ('cancelled', 'invalidated'))
                                                                                                                            GROUP BY dia
                                                                                                                                    `
            : await sql`
                      SELECT
                                  (data_criado AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
                                              COALESCE(SUM(total_amount), 0)::float8 AS faturamento,
                                                          COUNT(*)::int AS pedidos
                                                                    FROM pedidos_cache
                                                                              WHERE plataforma = 'shopee'
                                                                                          AND data_criado >= (${fromDay}::date)
                                                                                                      AND data_criado < ((${toDay}::date) + INTERVAL '1 day')
                                                                                                                  AND (status IS NULL OR status NOT IN ('CANCELLED', 'IN_CANCEL'))
                                                                                                                            GROUP BY dia
                                                                                                                                    `
        ) as { dia: string; faturamento: number; pedidos: number }[];
    return rows;
}

export async function getDailyTotalsRangeML(
    fromDay: string,
    toDay: string
  ): Promise<DailyTotalsResult> {
    if (!mlConectado()) return { connected: false };
    if ((await statusSyncPersistido("ml")) === "erro") return { connected: true, error: true };
    const porDia = await dailyTotals(fromDay, toDay, "ml");
    return { connected: true, error: false, porDia };
}

export async function getDailyTotalsRangeShopee(
    fromDay: string,
    toDay: string
  ): Promise<DailyTotalsResult> {
    if (!shopeeConectado()) return { connected: false };
    if ((await statusSyncPersistido("shopee")) === "erro") return { connected: true, error: true };
    const porDia = await dailyTotals(fromDay, toDay, "shopee");
    return { connected: true, error: false, porDia };
}

async function upsertPedidos(orders: OrderSummary[]): Promise<number> {
    let gravados = 0;
    for (const o of orders) {
          await sql`
                INSERT INTO pedidos_cache (
                        plataforma, pedido_id, data_criado, buyer_nickname, itens,
                                total_amount, status, shipping_mode, shipping_status, atualizado_em
                                      )
                                            VALUES (
                                                    ${o.plataforma}, ${String(o.id)}, ${o.dateCreated}, ${o.buyerNickname},
                                                            ${JSON.stringify(o.items)}, ${o.totalAmount}, ${o.status},
                                                                    ${o.shippingMode}, ${o.shippingStatus}, now()
                                                                          )
                                                                                ON CONFLICT (plataforma, pedido_id) DO UPDATE SET
                                                                                        data_criado = EXCLUDED.data_criado,
                                                                                                buyer_nickname = EXCLUDED.buyer_nickname,
                                                                                                        itens = EXCLUDED.itens,
                                                                                                                total_amount = EXCLUDED.total_amount,
                                                                                                                        status = EXCLUDED.status,
                                                                                                                                shipping_mode = EXCLUDED.shipping_mode,
                                                                                                                                        shipping_status = EXCLUDED.shipping_status,
                                                                                                                                                atualizado_em = now()
                                                                                                                                                    `;
          gravados++;
    }
    return gravados;
}

export interface SincronizarPedidosResult {
    janelaDias: number;
    periodo: { inicio: string; fim: string };
    mlConectado: boolean;
    shopeeConectado: boolean;
    pedidosAtualizados: number;
    atualizadoEm: string;
}

export async function sincronizarPedidos(
    dias: number
  ): Promise<SincronizarPedidosResult> {
    const hoje = todaySP();
    const inicio = diasAtras(hoje, Math.max(0, dias - 1));

  const tentouML = mlConectado();
    const tentouShopee = shopeeConectado();

  const [resultML, resultShopee] = await Promise.all([
        getOrdersRangeMLAoVivo(inicio, hoje),
        getOrdersRangeShopeeAoVivo(inicio, hoje),
      ]);

  const ordersML = resultML.connected && !resultML.error ? resultML.orders : [];
    const ordersShopee =
          resultShopee.connected && !resultShopee.error ? resultShopee.orders : [];

  const [gravadosML, gravadosShopee] = [
        await upsertPedidos(ordersML),
        await upsertPedidos(ordersShopee),
      ];

  if (tentouML) {
        await gravarStatusSync("ml", resultML.connected && !resultML.error ? "ok" : "erro");
  }
    if (tentouShopee) {
          await gravarStatusSync("shopee", resultShopee.connected && !resultShopee.error ? "ok" : "erro");
    }

  return {
        janelaDias: dias,
        periodo: { inicio, fim: hoje },
        mlConectado: resultML.connected,
        shopeeConectado: resultShopee.connected,
        pedidosAtualizados: gravadosML + gravadosShopee,
        atualizadoEm: new Date().toISOString(),
  };
}
