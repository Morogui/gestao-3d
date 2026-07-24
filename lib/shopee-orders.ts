// Busca de pedidos reais da Shopee (API v2 do Shopee Open Platform) —
// equivalente ao lib/ml-orders.ts, devolvendo o MESMO formato
// (OrderSummary/OrdersResult) pra reaproveitar toda a tela de Vendas, o
// ranking de produtos mais vendidos e o cálculo de demanda/produção sem
// precisar duplicar essa lógica por plataforma.
//
// Igual à ML, a Shopee guarda o access_token em cookie httpOnly (setado
// no /api/shopee/callback). Diferente da ML, o access_token da Shopee
// dura só 4h — mas agora, se tiver expirado, getValidShopeeAccessToken()
// (abaixo) renova ele na hora usando o refresh_token (válido por 30
// dias), sem precisar que o usuário reautorize o app do zero. Só cai de
// volta pro fluxo de "Conectar com Shopee" se o refresh_token também já
// tiver expirado.
import { cookies } from "next/headers";
import { refreshAccessToken, signAuthenticatedRequest } from "./shopee";
import {
  OrderItemSummary,
  OrderSummary,
  OrdersResult,
  DiaTotal,
  DailyTotalsResult,
} from "./ml-orders";

interface ShopeeOrderListEntry {
  order_sn: string;
}

interface ShopeeOrderItem {
  item_id: number;
  item_name?: string;
  item_sku?: string;
  model_name?: string;
  model_sku?: string;
  model_quantity_purchased?: number;
}

interface ShopeeOrderDetail {
  order_sn: string;
  order_status?: string;
  create_time?: number;
  total_amount?: number;
  buyer_username?: string;
  item_list?: ShopeeOrderItem[];
  shipping_carrier?: string;
  // "fulfilled_by_shopee" = Shopee Fulfillment (SPX, equivalente ao Full
  // da ML); "fulfilled_by_cb_seller" / "fulfilled_by_local_seller" =
  // vendedor cuida do envio.
  fulfillment_flag?: string;
}

interface ShopeeItemBaseInfo {
  item_id: number;
  image?: { image_url_list?: string[] };
}

// Sessão válida da Shopee pra fazer uma chamada autenticada. O
// access_token dura só 4h — bem menos que o refresh_token, que dura 30
// dias. Antes desse fix, assim que o cookie de access_token expirava
// (ou seja, toda vez que passavam 4h desde o último login), a tela caía
// direto pro fluxo de "Conectar com Shopee" — que abre a MESMA tela de
// autorização de primeira vez, mesmo a conexão real (a autorização da
// conta) ainda estando totalmente válida por até 30 dias. Reclamação do
// Guilherme em 2026-07-24: "toda vez que a Shopee precisa reconectar,
// fica parecendo que é a primeira vez". O refresh_token já era salvo em
// cookie desde o /api/shopee/callback, mas nunca era usado — essa função
// troca ele silenciosamente por um access_token novo sempre que o antigo
// já tiver expirado, então o usuário só cai na tela de autorização de
// verdade se o PRÓPRIO refresh_token também tiver expirado (só depois de
// 30 dias sem nenhum acesso). Como Server Components não conseguem
// reescrever cookies, o token renovado aqui não fica salvo de volta no
// cookie — a próxima carga de página renova de novo se precisar. Um
// pouco redundante, mas sem custo perceptível e sem precisar reautorizar
// à toa.
async function getValidShopeeAccessToken(): Promise<
  { accessToken: string; shopId: number } | null
> {
  const cookieStore = cookies();
  const shopIdStr = cookieStore.get("shopee_shop_id")?.value;
  if (!shopIdStr) return null;
  const shopId = Number(shopIdStr);

  const accessToken = cookieStore.get("shopee_access_token")?.value;
  if (accessToken) return { accessToken, shopId };

  const refreshToken = cookieStore.get("shopee_refresh_token")?.value;
  if (!refreshToken) return null;

  const renovado = await refreshAccessToken(refreshToken, shopId);
  if (!renovado) return null;
  return { accessToken: renovado.access_token, shopId };
}

function toEpochSeconds(day: string, endOfDay: boolean): number {
  const iso = `${day}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

// A Shopee limita get_order_list a no máximo 15 dias por chamada — quebra
// o intervalo pedido (ex: 1 mês) em pedaços de até 15 dias.
function splitInto15DayChunks(
  fromDay: string,
  toDay: string
): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  let cursor = new Date(`${fromDay}T12:00:00-03:00`);
  const end = new Date(`${toDay}T12:00:00-03:00`);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + 14);
    const realEnd = chunkEnd > end ? end : chunkEnd;
    chunks.push({
      from: cursor.toISOString().slice(0, 10),
      to: realEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(realEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

async function fetchOrderSnsInRange(
  accessToken: string,
  shopId: number,
  fromDay: string,
  toDay: string
): Promise<string[]> {
  const sns: string[] = [];
  for (const chunk of splitInto15DayChunks(fromDay, toDay)) {
    let cursor = "";
    let more = true;
    let guard = 0;
    // Teto de segurança pra nunca entrar num loop infinito caso a Shopee
    // devolva um cursor inválido/repetido.
    while (more && guard < 30) {
      guard++;
      const url = new URL(
        signAuthenticatedRequest("/api/v2/order/get_order_list", accessToken, shopId)
      );
      url.searchParams.set("time_range_field", "create_time");
      url.searchParams.set("time_from", String(toEpochSeconds(chunk.from, false)));
      url.searchParams.set("time_to", String(toEpochSeconds(chunk.to, true)));
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      const resp = await fetch(url.toString(), { cache: "no-store" });
      if (!resp.ok) break;
      const data = await resp.json();
      const list: ShopeeOrderListEntry[] = data?.response?.order_list ?? [];
      for (const o of list) if (o.order_sn) sns.push(o.order_sn);

      cursor = data?.response?.next_cursor ?? "";
      more = Boolean(data?.response?.more) && Boolean(cursor);
    }
  }
  return Array.from(new Set(sns));
}

async function fetchOrderDetails(
  orderSns: string[],
  accessToken: string,
  shopId: number
): Promise<ShopeeOrderDetail[]> {
  const details: ShopeeOrderDetail[] = [];
  // get_order_detail aceita até 50 order_sn por chamada.
  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    const url = new URL(
      signAuthenticatedRequest("/api/v2/order/get_order_detail", accessToken, shopId)
    );
    url.searchParams.set("order_sn_list", batch.join(","));
    url.searchParams.set(
      "response_optional_fields",
      "buyer_username,total_amount,order_status,item_list,create_time,shipping_carrier,fulfillment_flag"
    );
    const resp = await fetch(url.toString(), { cache: "no-store" });
    if (!resp.ok) continue;
    const data = await resp.json();
    const list: ShopeeOrderDetail[] = data?.response?.order_list ?? [];
    details.push(...list);
  }
  return details;
}

// Foto do produto: a Shopee não manda a imagem dentro do pedido, só o
// item_id — precisa de uma chamada separada em /product/get_item_base_info
// (mesmo espírito do multiget /items da ML em ml-orders.ts).
async function fetchItemImages(
  itemIds: number[],
  accessToken: string,
  shopId: number
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  const uniqueIds = Array.from(new Set(itemIds)).filter(Boolean);
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const batch = uniqueIds.slice(i, i + 50);
    const url = new URL(
      signAuthenticatedRequest("/api/v2/product/get_item_base_info", accessToken, shopId)
    );
    url.searchParams.set("item_id_list", batch.join(","));
    try {
      const resp = await fetch(url.toString(), { cache: "no-store" });
      if (!resp.ok) continue;
      const data = await resp.json();
      const list: ShopeeItemBaseInfo[] = data?.response?.item_list ?? [];
      for (const item of list) {
        map.set(item.item_id, item.image?.image_url_list?.[0] ?? null);
      }
    } catch (err) {
      console.error("[Shopee orders] erro ao buscar foto dos itens:", err);
    }
  }
  return map;
}

// Versão "leve" de fetchOrderDetails — pede só total_amount/create_time
// (sem item_list, buyer, shipping) — usada só pra somar faturamento por
// dia (recorde de melhor dia da loja em até 90 dias). Mesmo espírito da
// getDailyTotalsRange da ML em lib/ml-orders.ts: evita o custo de buscar
// item_list + foto de cada pedido quando só precisamos do total do dia.
async function fetchOrderTotalsOnly(
  orderSns: string[],
  accessToken: string,
  shopId: number
): Promise<{ create_time?: number; total_amount?: number }[]> {
  const details: { create_time?: number; total_amount?: number }[] = [];
  for (let i = 0; i < orderSns.length; i += 50) {
    const batch = orderSns.slice(i, i + 50);
    const url = new URL(
      signAuthenticatedRequest("/api/v2/order/get_order_detail", accessToken, shopId)
    );
    url.searchParams.set("order_sn_list", batch.join(","));
    url.searchParams.set("response_optional_fields", "total_amount,create_time");
    const resp = await fetch(url.toString(), { cache: "no-store" });
    if (!resp.ok) continue;
    const data = await resp.json();
    const list: { create_time?: number; total_amount?: number }[] =
      data?.response?.order_list ?? [];
    details.push(...list);
  }
  return details;
}

// Recorde da loja (melhor dia, até 90 dias) — equivalente Shopee de
// getDailyTotalsRange (ml-orders.ts), pedido pelo Guilherme em
// 2026-07-22 pra o card de "Recorde da loja" parar de ser só Mercado
// Livre. Reaproveita a paginação de order_sn já existente
// (fetchOrderSnsInRange) e só busca total/data de cada pedido — sem
// item_list nem foto — pra não pesar a página.
export async function getDailyTotalsRange(
  fromDay: string,
  toDay: string
): Promise<DailyTotalsResult> {
  const sessao = await getValidShopeeAccessToken();
  if (!sessao) {
    return { connected: false };
  }
  const { accessToken, shopId } = sessao;

  try {
    const orderSns = await fetchOrderSnsInRange(accessToken, shopId, fromDay, toDay);
    if (orderSns.length === 0) {
      return { connected: true, error: false, porDia: [] };
    }

    const totals = await fetchOrderTotalsOnly(orderSns, accessToken, shopId);
    const porDiaMap = new Map<string, { faturamento: number; pedidos: number }>();
    for (const o of totals) {
      if (!o.create_time) continue;
      const diaKey = new Date(
        o.create_time * 1000 - 3 * 60 * 60 * 1000
      )
        .toISOString()
        .slice(0, 10);
      const atual = porDiaMap.get(diaKey) ?? { faturamento: 0, pedidos: 0 };
      atual.faturamento += o.total_amount ?? 0;
      atual.pedidos += 1;
      porDiaMap.set(diaKey, atual);
    }

    const porDia: DiaTotal[] = Array.from(porDiaMap.entries()).map(
      ([dia, v]) => ({ dia, faturamento: v.faturamento, pedidos: v.pedidos })
    );
    return { connected: true, error: false, porDia };
  } catch (err) {
    console.error("[Shopee orders] erro ao buscar totais por dia:", err);
    return { connected: true, error: true };
  }
}

export async function getOrdersRange(
  fromDay: string,
  toDay: string
): Promise<OrdersResult> {
  const sessao = await getValidShopeeAccessToken();
  if (!sessao) {
    return { connected: false };
  }
  const { accessToken, shopId } = sessao;

  try {
    const orderSns = await fetchOrderSnsInRange(accessToken, shopId, fromDay, toDay);
    if (orderSns.length === 0) {
      return { connected: true, error: false, orders: [] };
    }

    const details = await fetchOrderDetails(orderSns, accessToken, shopId);
    const allItemIds = details.flatMap((d) =>
      (d.item_list ?? []).map((it) => it.item_id).filter(Boolean)
    );
    const imageMap = await fetchItemImages(allItemIds, accessToken, shopId);

    const orders: OrderSummary[] = details.map((d) => {
      const items: OrderItemSummary[] = (d.item_list ?? []).map((it) => {
        const sku = it.model_sku || it.item_sku || "";
        const titulo = it.model_name
          ? `${it.item_name ?? "item"} - ${it.model_name}`
          : it.item_name ?? "item";
        return {
          itemId: String(it.item_id ?? "—"),
          title: titulo,
          quantity: it.model_quantity_purchased ?? 1,
          sku: sku || String(it.item_id ?? "—"),
          hasCustomSku: Boolean(sku),
          thumbnail: it.item_id ? imageMap.get(it.item_id) ?? null : null,
        };
      });

      let shippingMode = "Shopee";
      if (d.fulfillment_flag === "fulfilled_by_shopee") {
        shippingMode = "Shopee Fulfillment (SPX)";
      } else if (d.shipping_carrier) {
        shippingMode = d.shipping_carrier;
      }

      return {
        id: d.order_sn,
        dateCreated: d.create_time
          ? new Date(d.create_time * 1000).toISOString()
          : new Date().toISOString(),
        buyerNickname: d.buyer_username || "—",
        items,
        totalAmount: d.total_amount ?? 0,
        // status cru (ex: "READY_TO_SHIP") — a tela aplica
        // labelShopeeOrderStatus() na hora de exibir, mesmo padrão do
        // labelOrderStatus() da ML.
        status: d.order_status ?? "—",
        shippingMode,
        // Shopee não separa status de pagamento de status de envio — o
        // mesmo order_status já diz se foi vendido/despachado (ver
        // pedidoFoiVendido em lib/ml-orders.ts).
        shippingStatus: d.order_status ?? "—",
        plataforma: "shopee",
      };
    });

    return { connected: true, error: false, orders };
  } catch (err) {
    console.error("[Shopee orders] erro ao buscar pedidos:", err);
    return { connected: true, error: true };
  }
}
