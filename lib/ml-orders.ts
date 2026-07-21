import { cookies } from "next/headers";
import { ML_API_BASE, labelLogisticType } from "./mercadolivre";

export interface OrderSummary {
  id: number;
  dateCreated: string;
  buyerNickname: string;
  itemsSummary: string;
  totalAmount: number;
  status: string;
  shippingMode: string;
}

export type OrdersResult =
  | { connected: false }
  | { connected: true; error: true }
  | { connected: true; error: false; orders: OrderSummary[] };

interface MLOrderItem {
  item?: { title?: string };
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

  const orders = await Promise.all(
    rawOrders.map(async (order): Promise<OrderSummary> => {
      const itemsSummary = (order.order_items ?? [])
        .map((oi) => `${oi.item?.title ?? "item"} x${oi.quantity ?? 1}`)
        .join(", ");

      let shippingMode = "—";
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
            shippingMode = labelLogisticType(shipData?.logistic_type);
          }
        } catch {
          // se a busca de envio falhar, mantém "—" e segue com o resto
        }
      }

      return {
        id: order.id,
        dateCreated: order.date_created,
        buyerNickname: order.buyer?.nickname ?? "—",
        itemsSummary: itemsSummary || "—",
        totalAmount: order.total_amount ?? 0,
        status: order.status ?? "—",
        shippingMode,
      };
    })
  );

  return { connected: true, error: false, orders };
}
