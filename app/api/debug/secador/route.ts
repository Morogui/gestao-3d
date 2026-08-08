import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// Rota de diagnóstico TEMPORÁRIA (2026-08-08) — pra descobrir se "Suporte
// Secador de Cabelo Preto Sem Parafuso" realmente não vendeu no Full nos
// últimos 30 dias, ou se tem pedido mas ele não está batendo. Devolve o
// JSON cru de order_items dos últimos 30 dias cujo título tenha "secador".
// Remover depois de usar.
export async function GET() {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;

  if (!accessToken || !userId) {
    return NextResponse.json({ connected: false });
  }

  const hoje = new Date();
  const dataAtras = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  const dateFrom = dataAtras.toISOString();
  const dateTo = hoje.toISOString();

  const rawOrders: any[] = [];
  for (let page = 0; page < 6; page++) {
    const resp = await fetch(
      `${ML_API_BASE}/orders/search?seller=${userId}&sort=date_desc&limit=50&offset=${page * 50}` +
        `&order.date_created.from=${encodeURIComponent(dateFrom)}` +
        `&order.date_created.to=${encodeURIComponent(dateTo)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );
    if (!resp.ok) break;
    const data = await resp.json();
    const results = data.results ?? [];
    rawOrders.push(...results);
    if (results.length < 50) break;
  }

  const relevantes = rawOrders
    .map((o: any) => ({
      orderId: o.id,
      dateCreated: o.date_created,
      order_items: (o.order_items ?? []).map((oi: any) => ({
        title: oi.item?.title,
        id: oi.item?.id,
        seller_sku: oi.item?.seller_sku,
        variation_id: oi.item?.variation_id,
        quantity: oi.quantity,
      })),
      shipping: o.shipping,
    }))
    .filter((o: any) =>
      (o.order_items ?? []).some((oi: any) =>
        (oi.title ?? "").toLowerCase().includes("secador")
      )
    );

  // Pra cada pedido relevante, também busca o shipment pra saber se foi
  // Full ou Mercado Envios normal — é isso que decide se conta como
  // "vendidoFull7d".
  const comShipping = await Promise.all(
    relevantes.map(async (o: any) => {
      if (!o.shipping?.id) return { ...o, logisticType: null };
      try {
        const shipResp = await fetch(`${ML_API_BASE}/shipments/${o.shipping.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!shipResp.ok) return { ...o, logisticType: "erro-" + shipResp.status };
        const shipData = await shipResp.json();
        const logisticType =
          shipData?.logistic_type ??
          shipData?.shipping_option?.logistic_type ??
          shipData?.logistic?.type ??
          null;
        return { ...o, logisticType };
      } catch {
        return { ...o, logisticType: "erro-fetch" };
      }
    })
  );

  return NextResponse.json({
    totalPedidos: rawOrders.length,
    pedidosComSecador: comShipping.length,
    amostra: comShipping,
  });
}
