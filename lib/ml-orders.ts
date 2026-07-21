import { cookies } from "next/headers";
import { ML_API_BASE, labelLogisticType } from "./mercadolivre";

export interface OrderItemSummary {
  itemId: string;
  title: string;
  quantity: number;
  sku: string;
  thumbnail: string | null;
}

export interface OrderSummary {
  id: number;
  dateCreated: string;
  buyerNickname: string;
  items: OrderItemSummary[];
  totalAmount: number;
  status: string;
  shippingMode: string;
}

export type OrdersResult =
  | { connected: false }
  | { connected: true; error: true }
  | { connected: true; error: false; orders: OrderSummary[] };

interface MLOrderItem {
  item?: { id?: string; title?: string; seller_custom_field?: string };
  quantity?: number;
}

interface MLOrder {
  id: number;
  date_created: string;
  buyer?: { nickname?: string };
  order_items?: MLOrderItem[];
  total_amount?: number;
  status?: string;
  shipping?: { id?: number };
}

interface MLItemDetail {
  id: string;
  thumbnail?: string;
  seller_custom_field?: string;
}

function toHttps(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.startsWith("http://") ? url.replace("http://", "https://") : url;
}

// Busca detalhes (foto + SKU) de uma lista de item ids em uma única
// chamada usando o endpoint multiget /items?ids=... da ML (mais rápido
// do que uma chamada por item).
async function fetchItemDetails(
  itemIds: string[],
  accessToken: string
): Promise<Map<string, MLItemDetail>> {
  const map = new Map<string, MLItemDetail>();
  const uniqueIds = Array.from(new Set(itemIds)).filter(Boolean);
  if (uniqueIds.length === 0) return map;

  // A API multiget aceita até 20 ids por chamada.
  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = uniqueIds.slice(i, i + 20);
    try {
      const resp = await fetch(
        `${ML_API_BASE}/items?ids=${batch.join(",")}&attributes=id,thumbnail,seller_custom_field`,
        { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const entry of data ?? []) {
        if (entry?.code === 200 && entry.body?.id) {
          map.set(entry.body.id, entry.body);
        }
      }
    } catch {
      // se uma leva falhar, segue com o que já temos
    }
  }
  return map;
}

// Extrai a modalidade de envio de forma tolerante a diferenças no
// formato da resposta da API de shipments — nem sempre o campo vem no
// mesmo lugar dependendo do tipo de envio.
function extractLogisticType(shipData: any): string | undefined {
  return (
    shipData?.logistic_type ??
    shipData?.shipping_option?.logistic_type ??
    shipData?.logistic?.type ??
    undefined
  );
}

// Busca os pedidos recentes do vendedor autenticado. Roda no servidor
// (Server Component), usando o access_token guardado em cookie httpOnly
// no /api/mercadolivre/callback.
//
// Nota: se o access_token tiver expirado (dura ~6h), a chamada falha com
// 401 e devolvemos { connected: true, error: true } — a renovação
// automática via refresh_token fica pra uma próxima iteração (precisa
// rodar num Route Handler, que consegue re-gravar cookies; um Server
// Component não consegue).
export async function getOrders(): Promise<OrdersResult> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;

  if (!accessToken || !userId) {
    return { connected: false };
  }

  const resp = await fetch(
    `${ML_API_BASE}/orders/search?seller=${userId}&sort=date_desc&limit=50`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );

  if (!resp.ok) {
    return { connected: true, error: true };
  }

  const data = await resp.json();
  const rawOrders: MLOrder[] = data.results ?? [];

  // Busca foto + SKU de todos os itens de todos os pedidos de uma vez
  const allItemIds = rawOrders.flatMap((order) =>
    (order.order_items ?? [])
      .map((oi) => oi.item?.id)
      .filter((id): id is string => Boolean(id))
  );
  const itemDetails = await fetchItemDetails(allItemIds, accessToken);

  const orders = await Promise.all(
    rawOrders.map(async (order): Promise<OrderSummary> => {
      const items: OrderItemSummary[] = (order.order_items ?? []).map((oi) => {
        const detail = oi.item?.id ? itemDetails.get(oi.item.id) : undefined;
        return {
          itemId: oi.item?.id ?? "—",
          title: oi.item?.title ?? "item",
          quantity: oi.quantity ?? 1,
          sku:
            oi.item?.seller_custom_field ||
            detail?.seller_custom_field ||
            oi.item?.id ||
            "—",
          thumbnail: toHttps(detail?.thumbnail),
        };
      });

      let shippingMode = "Mercado Envios";
      const shippingId = order.shipping?.id;
      if (shippingId) {
        try {
          const shipResp = await fetch(
            `${ML_API_BASE}/shipments/${shippingId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: "no-store",
            }
          );
          if (shipResp.ok) {
            const shipData = await shipResp.json();
            const logisticType = extractLogisticType(shipData);
            if (logisticType) {
              shippingMode = labelLogisticType(logisticType);
            } else if (shipData?.mode) {
              // fallback: pelo menos mostra o modo cru da ML se não achar
              // o logistic_type (ajuda a diagnosticar casos não mapeados)
              shippingMode = `Mercado Envios (${shipData.mode})`;
            }
          } else {
            console.error(
              `[ML orders] shipment ${shippingId} respondeu ${shipResp.status}`
            );
          }
        } catch (err) {
          console.error(`[ML orders] erro ao buscar shipment ${shippingId}:`, err);
        }
      } else {
        shippingMode = "—";
      }

      return {
        id: order.id,
        dateCreated: order.date_created,
        buyerNickname: order.buyer?.nickname ?? "—",
        items,
        totalAmount: order.total_amount ?? 0,
        status: order.status ?? "—",
        shippingMode,
      };
    })
  );

  return { connected: true, error: false, orders };
}
