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
import { mlEstaConectado } from "./ml-auth";
import { shopeeEstaConectado } from "./shopee-auth";

type Plataforma = "ml" | "shopee";

// Mesma checagem que getValidMLAccessToken/getValidShopeeAccessToken já
// fazem — só olha se existe uma sessão salva no banco, sem chamar a API.
// Preserva o comportamento de "conecte sua conta"/"reconectar" nas telas
// mesmo lendo os pedidos do cache em vez de ao vivo.
async function mlConectado(): Promise<boolean> {
  return mlEstaConectado();
}

// 2026-08-26: migrado de leitura de cookie ("shopee_shop_id") pra
// checagem no banco (tabela shopee_auth) — mesma causa raiz do "Shopee
// caindo toda hora" corrigida em lib/shopee-auth.ts. O cron de 1 em 1
// minuto nunca tinha cookie de navegador, então essa função sempre
// devolvia false pra ele (mesmo com a conta Shopee de verdade conectada
// e o refresh_token ainda válido por semanas) — e como tentouShopee
// abaixo controla se sync_status é gravado, e getOrdersRangeShopeeAoVivo
// também dependia do mesmo cookie, a Shopee só sincronizava quando
// alguém abria o navegador com o cookie ainda vivo (o access_token da
// Shopee dura só 4h). Agora consulta o banco, que é a fonte de verdade
// pra qualquer contexto (cron incluso).
async function shopeeConectado(): Promise<boolean> {
  return shopeeEstaConectado();
}

// Pedido do Guilherme em 2026-07-27: "não está trazendo números da
// Shopee" — a causa raiz era a sessão da Shopee ter expirado (token/
// refresh_token mortos), mas a tela de Vendas nunca mostrava o aviso de
// "sessão expirada, reconecte" porque mlConectado()/shopeeConectado()
// acima só conferem se existe uma sessão salva, não se ela ainda
// funciona de verdade — então "sessão existe mas tá morta" e "nunca
// conectou" pareciam a mesma coisa (silêncio, zero pedidos, sem pista do
// motivo).
//
// A tela não pode chamar a API ao vivo a cada carregamento (é o motivo
// desse arquivo existir), então guardamos aqui o resultado da ÚLTIMA
// tentativa REAL de falar com a API (a que sincronizarPedidos() já faz).
// Importante: antes do fix de 2026-08-26 (ver shopeeConectado() acima),
// o cron de 1 em 1 minuto (vercel.json) nunca tinha cookie/sessão
// nenhuma pra tentar do lado da Shopee — se gravássemos o resultado dele
// sem filtro, a tabela abaixo ficaria marcada como "desconectado" a cada
// minuto, mesmo com a conta perfeitamente válida. Agora que
// mlConectado()/shopeeConectado() consultam o banco (fonte de verdade
// acessível de qualquer contexto), tentouML/tentouShopee refletem a
// conexão real, não mais a presença de um cookie de navegador — mas o
// filtro continua existindo por segurança/clareza do fluxo.
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

// Substitui getOrdersRange (lib/ml-orders.ts) nas telas — mesma
// assinatura/retorno, só que lendo do registro local em vez de bater na
// API da ML a cada chamada.
export async function getOrdersRangeML(
  fromDay: string,
  toDay: string
): Promise<OrdersResult> {
  if (!(await mlConectado())) return { connected: false };
  if ((await statusSyncPersistido("ml")) === "erro") return { connected: true, error: true };
  const orders = await queryRange(fromDay, toDay, "ml");
  return { connected: true, error: false, orders };
}

// Substitui getOrdersRange (lib/shopee-orders.ts) nas telas.
export async function getOrdersRangeShopee(
  fromDay: string,
  toDay: string
): Promise<OrdersResult> {
  if (!(await shopeeConectado())) return { connected: false };
  if ((await statusSyncPersistido("shopee")) === "erro") return { connected: true, error: true };
  const orders = await queryRange(fromDay, toDay, "shopee");
  return { connected: true, error: false, orders };
}

async function dailyTotals(
  fromDay: string,
  toDay: string,
  plataforma: Plataforma
): Promise<DiaTotal[]> {
  const rows = (await sql`
    SELECT
      (data_criado AT TIME ZONE 'America/Sao_Paulo')::date::text AS dia,
      COALESCE(SUM(total_amount), 0)::float8 AS faturamento,
      COUNT(*)::int AS pedidos
    FROM pedidos_cache
    WHERE plataforma = ${plataforma}
      AND data_criado >= (${fromDay}::date)
      AND data_criado < ((${toDay}::date) + INTERVAL '1 day')
    GROUP BY dia
  `) as { dia: string; faturamento: number; pedidos: number }[];
  return rows;
}

// Substitui getDailyTotalsRange (lib/ml-orders.ts) — usado pelo recorde
// da loja (90 dias) na aba Vendas.
export async function getDailyTotalsRangeML(
  fromDay: string,
  toDay: string
): Promise<DailyTotalsResult> {
  if (!(await mlConectado())) return { connected: false };
  if ((await statusSyncPersistido("ml")) === "erro") return { connected: true, error: true };
  const porDia = await dailyTotals(fromDay, toDay, "ml");
  return { connected: true, error: false, porDia };
}

// Substitui getDailyTotalsRange (lib/shopee-orders.ts).
export async function getDailyTotalsRangeShopee(
  fromDay: string,
  toDay: string
): Promise<DailyTotalsResult> {
  if (!(await shopeeConectado())) return { connected: false };
  if ((await statusSyncPersistido("shopee")) === "erro") return { connected: true, error: true };
  const porDia = await dailyTotals(fromDay, toDay, "shopee");
  return { connected: true, error: false, porDia };
}

// Grava (upsert) uma lista de pedidos já buscados ao vivo da ML/Shopee no
// registro local — chamada só por sincronizarPedidos() abaixo. Idempotente:
// pode rodar quantas vezes quiser pro mesmo pedido, sempre atualizando pro
// estado mais recente (status pode mudar: pago → cancelado, por exemplo).
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

// Único ponto do sistema que efetivamente chama a API AO VIVO da ML e da
// Shopee pra atualizar o registro de pedidos. Chamada por:
// 1) /api/pedidos/sincronizar (GET) — o cron da Vercel, de 1 em 1 minuto
//    (vercel.json), com uma janela curta (poucos dias) — é o que mantém
//    "quase em tempo real" sem sair batendo na API o tempo todo.
// 2) /api/estoque/sincronizar-vendas — que já rodava sozinho toda vez que
//    a aba Estoque é aberta; agora além de calcular a baixa de estoque,
//    também atualiza o registro (janela um pouco maior, 10 dias) — reforço
//    extra de atualização mesmo fora do minuto do cron.
export async function sincronizarPedidos(
  dias: number
): Promise<SincronizarPedidosResult> {
  const hoje = todaySP();
  const inicio = diasAtras(hoje, Math.max(0, dias - 1));

  // Só é seguro gravar o status (ok/erro) em sync_status quando ESSA
  // chamada de verdade tinha uma sessão da plataforma pra tentar — ver
  // comentário em cima de garantirTabelaStatusSync(). Desde 2026-08-26
  // mlConectado()/shopeeConectado() consultam o banco (não mais cookie),
  // então o cron finalmente reflete a conexão real das duas contas.
  const tentouML = await mlConectado();
  const tentouShopee = await shopeeConectado();

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
