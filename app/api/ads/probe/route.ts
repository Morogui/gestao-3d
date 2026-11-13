import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";

// ROTA TEMPORARIA — sonda de custos/reembolso de envio e atribuicao de Ads
// por pedido. GET /api/ads/probe?order=ID
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get("order");
  const tk = await getValidMLAccessToken();
  if (!tk || !orderId) return NextResponse.json({ erro: "sem token/order" });
  const h = { Authorization: `Bearer ${tk.accessToken}` };
  const g = async (u: string, extra?: Record<string, string>) => {
    const r = await fetch(`https://api.mercadolibre.com${u}`, {
      headers: { ...h, ...(extra ?? {}) },
      cache: "no-store",
    });
    return { status: r.status, body: (await r.text()).slice(0, 2500) };
  };
  const out: Record<string, unknown> = {};
  const o = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, { headers: h, cache: "no-store" });
  const oj = await o.json();
  out.order_tags = oj?.tags;
  out.order_keys = Object.keys(oj ?? {});
  out.payments = (oj?.payments ?? []).map((p: Record<string, unknown>) => ({
    total_paid_amount: p.total_paid_amount,
    marketplace_fee: p.marketplace_fee,
    shipping_cost: p.shipping_cost,
    taxes_amount: p.taxes_amount,
  }));
  out.order_items = (oj?.order_items ?? []).map((i: Record<string, unknown>) => ({
    sale_fee: i.sale_fee,
    full_unit_price: i.full_unit_price,
    unit_price: i.unit_price,
  }));
  const sid = oj?.shipping?.id;
  out.shipping_id = sid;
  if (sid) {
    out.costs = await g(`/shipments/${sid}/costs`);
    out.shipment = await g(`/shipments/${sid}`);
  }
  out.discounts = await g(`/orders/${orderId}/discounts`);
  return NextResponse.json(out);
}
