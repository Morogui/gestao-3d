import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ROTA TEMPORARIA — sonda RESTRITA (somente leitura) do faturamento do ML,
// filtrada por pedidos Flex informados. Nao e proxy livre. Sera removida.
//   ?key=2026-12-01&group=ML&orders=ID1,ID2,ID3&start=0
// Devolve so as linhas de cobranca/bonificacao ligadas a esses pedidos/envios.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const key = q.get("key") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NextResponse.json({ erro: "key invalida" }, { status: 400 });
  const group = q.get("group") === "MP" ? "MP" : "ML";
  const orders = (q.get("orders") ?? "").split(",").filter((s) => /^\d{10,20}$/.test(s)).slice(0, 5);
  if (orders.length === 0) return NextResponse.json({ erro: "sem pedidos" }, { status: 400 });
  const maxPages = Math.min(Math.max(Number(q.get("pages") ?? 8) || 8, 1), 12);
  let lastId = Math.max(Number(q.get("start") ?? 0) || 0, 0);
  const tk = await getValidMLAccessToken();
  if (!tk) return NextResponse.json({ erro: "sem token" }, { status: 401 });
  const H = { Authorization: `Bearer ${tk.accessToken}` };

  // ids de envio/pack dos pedidos informados (para casar com o faturamento)
  const ids = new Set<string>(orders);
  for (const o of orders) {
    const r = await fetch(`https://api.mercadolibre.com/orders/${o}`, { headers: H, cache: "no-store" });
    if (!r.ok) continue;
    const j = await r.json();
    if (j?.shipping?.id) ids.add(String(j.shipping.id));
    if (j?.pack_id) ids.add(String(j.pack_id));
  }

  const achados: unknown[] = [];
  let paginas = 0;
  let status = 200;
  let total = 0;
  for (let p = 0; p < maxPages; p++) {
    const u =
      `https://api.mercadolibre.com/billing/integration/periods/key/${key}/group/${group}/details` +
      `?document_type=BILL&limit=150${lastId ? `&last_id=${lastId}` : ""}`;
    const r = await fetch(u, { headers: H, cache: "no-store" });
    status = r.status;
    if (!r.ok) break;
    const j = await r.json();
    total = Number(j?.total ?? total);
    const res: Record<string, any>[] = Array.isArray(j?.results) ? j.results : [];
    if (res.length === 0) break;
    for (const d of res) {
      const s = Array.isArray(d?.sales_info) ? d.sales_info : [];
      const hit =
        s.some((x: any) => ids.has(String(x?.order_id))) ||
        ids.has(String(d?.shipping_info?.shipping_id)) ||
        ids.has(String(d?.shipping_info?.pack_id));
      if (hit) {
        const c = d.charge_info ?? {};
        achados.push({
          tipo: `${c.detail_type}|${c.detail_sub_type}`,
          descricao: c.transaction_detail,
          valor: c.detail_amount,
          pedido: s[0]?.order_id,
          envio: d?.shipping_info?.shipping_id,
          desconto: d?.discount_info,
        });
      }
    }
    paginas++;
    const nextId = Number(j?.last_id ?? 0);
    if (!nextId || nextId === lastId) { lastId = 0; break; }
    lastId = nextId;
    await new Promise((r) => setTimeout(r, 700));
  }
  return NextResponse.json({ status, paginas, total, proximo_start: lastId, ids: Array.from(ids), achados });
}
