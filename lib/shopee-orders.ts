// Busca de pedidos reais da Shopee (API v2 do Shopee Open Platform) —
// equivalente ao lib/ml-orders.ts, devolvendo o MESMO formato
// (OrderSummary/OrdersResult) pra reaproveitar toda a tela de Vendas, o
// ranking de produtos mais vendidos e o cálculo de demanda/produção sem
// precisar duplicar essa lógica por plataforma.
//
// Igual à ML, a Shopee guarda o access_token em cookie httpOnly (setado
// no /api/shopee/callback). Diferente da ML, o access_token da Shopee
// dura só 4h — se tiver expirado, a chamada falha e devolvemos
// { connected: true, error: true } (renovação automática via
// refresh_token fica pra uma próxima etapa, mesma limitação já registrada
// em ml-orders.ts: um Server Component não consegue reescrever cookies).
import { cookies } from "next/headers";
import { signAuthenticatedRequest } from "./shopee";
import { OrderItemSummary, OrderSummary, OrdersResult } from "./ml-orders";

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

export async function getOrdersRange(
  fromDay: string,
  toDay: string
): Promise<OrdersResult> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("shopee_access_token")?.value;
  const shopIdStr = cookieStore.get("shopee_shop_id")?.value;

  if (!accessToken || !shopIdStr) {
    return { connected: false };
  }
  const shopId = Number(shopIdStr);

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
        // mesmo order_status já diz se foi despachado (ver
        // pedidoFoiEnviado em lib/ml-orders.ts).
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
