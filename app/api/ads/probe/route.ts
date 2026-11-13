import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ROTA TEMPORARIA — sonda RESTRITA de leitura do faturamento do ML.
// Nao e proxy livre: so consulta /billing/integration/.../details de um
// periodo (key AAAA-MM-DD) e devolve um RESUMO por tipo de lancamento
// (nada sensivel). Sera removida apos o teste.
//   ?key=2026-12-01&group=ML&doc=BILL&pages=12
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const key = q.get("key") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NextResponse.json({ erro: "key invalida" }, { status: 400 });
  const group = q.get("group") === "MP" ? "MP" : "ML";
  const doc = q.get("doc") === "CREDIT_NOTE" ? "CREDIT_NOTE" : "BILL";
  const maxPages = Math.min(Math.max(Number(q.get("pages") ?? 12) || 12, 1), 14);
  const tk = await getValidMLAccessToken();
  if (!tk) return NextResponse.json({ erro: "sem token" }, { status: 401 });

  const agg: Record<string, { n: number; soma: number; exemplo?: unknown }> = {};
  let lastId = 0;
  let paginas = 0;
  let status = 200;
  let total = 0;
  for (let p = 0; p < maxPages; p++) {
    const u =
      `https://api.mercadolibre.com/billing/integration/periods/key/${key}/group/${group}/details` +
      `?document_type=${doc}&limit=150${lastId ? `&last_id=${lastId}` : ""}`;
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tk.accessToken}` }, cache: "no-store" });
    status = r.status;
    if (!r.ok) break;
    const j = await r.json();
    total = Number(j?.total ?? total);
    const res: Record<string, any>[] = Array.isArray(j?.results) ? j.results : [];
    if (res.length === 0) break;
    for (const d of res) {
      const c = d?.charge_info ?? {};
      const k = `${c.detail_type}|${c.detail_sub_type}|${c.transaction_detail}`;
      const a = (agg[k] = agg[k] ?? { n: 0, soma: 0 });
      a.n++;
      a.soma += Number(c.detail_amount ?? 0);
      if (!a.exemplo && (d?.sales_info || d?.shipping_info)) {
        a.exemplo = { sales_info: d.sales_info, shipping_info: d.shipping_info, discount_info: d.discount_info };
      }
    }
    paginas++;
    const nextId = Number(j?.last_id ?? 0);
    if (!nextId || nextId === lastId) break;
    lastId = nextId;
    await new Promise((r) => setTimeout(r, 400));
  }
  const resumo = Object.entries(agg)
    .map(([k, v]) => ({ tipo: k, n: v.n, soma: Math.round(v.soma * 100) / 100, exemplo: v.exemplo }))
    .sort((a, b) => b.n - a.n);
  return NextResponse.json({ status, paginas, total, resumo });
}
