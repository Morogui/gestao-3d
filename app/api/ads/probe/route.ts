import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ROTA TEMPORARIA — sonda RESTRITA (somente leitura) do Mercado Pago para
// um pedido: pagamento (/v1/payments/{id}) e lista de relatorios. Sera removida.
//   ?order=ID
export async function GET(request: NextRequest) {
  const order = request.nextUrl.searchParams.get("order") ?? "";
  if (!/^\d{8,20}$/.test(order)) return NextResponse.json({ erro: "parametros invalidos" }, { status: 400 });
  const tk = await getValidMLAccessToken();
  if (!tk) return NextResponse.json({ erro: "sem token" }, { status: 401 });
  const H = { Authorization: `Bearer ${tk.accessToken}` };
  const out: Record<string, unknown> = {};
  const ro = await fetch(`https://api.mercadolibre.com/orders/${order}`, { headers: H, cache: "no-store" });
  const j: any = ro.ok ? await ro.json() : {};
  const pids: string[] = (j?.payments ?? []).map((p: any) => String(p.id));
  out.pagamentos_ids = pids;
  out.payments_do_pedido = (j?.payments ?? []).map((p: any) => ({
    id: p.id, total: p.total_paid_amount, transaction: p.transaction_amount, frete: p.shipping_cost, taxa_mp: p.marketplace_fee, status: p.status,
  }));
  for (const pid of pids.slice(0, 1)) {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${pid}`, { headers: H, cache: "no-store" });
    const t = await r.text();
    let v: any = t.slice(0, 400);
    try {
      const p = JSON.parse(t);
      v = {
        status: r.status, net: p?.transaction_details?.net_received_amount, shipping_amount: p?.shipping_amount,
        fee_details: p?.fee_details, charges_details: (p?.charges_details ?? []).map((c: any) => ({ n: c.name, t: c.type, a: c.amounts, ac: c.accounts })),
        td: p?.transaction_details, ms: p?.money_release_status, rel: p?.money_release_date,
      };
    } catch {}
    out.mp_payment = v;
  }
  for (const u of ["settlement_report/list", "release_report/list"]) {
    const r = await fetch(`https://api.mercadopago.com/v1/account/${u}`, { headers: H, cache: "no-store" });
    out[u] = { status: r.status, body: (await r.text()).slice(0, 300) };
  }
  return NextResponse.json(out);
}
