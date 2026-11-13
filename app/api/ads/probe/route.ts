import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ROTA TEMPORARIA — sonda RESTRITA (somente leitura) do faturamento do ML,
// filtrando por pedido (order_ids). Nao e proxy livre. Sera removida.
//   ?key=2026-12-01&order=ID&group=ML
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const key = q.get("key") ?? "";
  const order = q.get("order") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !/^\d{8,20}$/.test(order)) {
    return NextResponse.json({ erro: "parametros invalidos" }, { status: 400 });
  }
  const group = q.get("group") === "MP" ? "MP" : "ML";
  const tk = await getValidMLAccessToken();
  if (!tk) return NextResponse.json({ erro: "sem token" }, { status: 401 });
  const H = { Authorization: `Bearer ${tk.accessToken}` };

  // tambem filtra pelo envio do pedido
  const ids: string[] = [order];
  const ro = await fetch(`https://api.mercadolibre.com/orders/${order}`, { headers: H, cache: "no-store" });
  let shipping = "";
  if (ro.ok) {
    const j = await ro.json();
    shipping = j?.shipping?.id ? String(j.shipping.id) : "";
  }
  const out: Record<string, unknown> = { shipping };
  const pegar = async (rotulo: string, extra: string) => {
    const u =
      `https://api.mercadolibre.com/billing/integration/periods/key/${key}/group/${group}/details` +
      `?document_type=BILL&limit=50&${extra}`;
    const r = await fetch(u, { headers: H, cache: "no-store" });
    const t = await r.text();
    let linhas: unknown = t.slice(0, 600);
    try {
      const j = JSON.parse(t);
      linhas = {
        total: j?.total,
        itens: (Array.isArray(j?.results) ? j.results : []).map((d: any) => ({
          tipo: `${d?.charge_info?.detail_type}|${d?.charge_info?.detail_sub_type}`,
          descricao: d?.charge_info?.transaction_detail,
          valor: d?.charge_info?.detail_amount,
          mkt: d?.marketplace_info?.marketplace,
          envio: d?.shipping_info?.shipping_id,
          recv: d?.shipping_info?.receiver_shipping_cost,
          desc: d?.discount_info,
        })),
      };
    } catch {}
    out[rotulo] = { status: r.status, linhas };
  };
  await pegar("por_pedido", `order_ids=${order}`);
  await new Promise((r) => setTimeout(r, 500));
  await pegar("por_pedido_envio", `order_ids=${order}&marketplace_type=SHIPPING`);
  return NextResponse.json(out);
}
