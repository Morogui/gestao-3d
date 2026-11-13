import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";

// ROTA TEMPORARIA — sonda RESTRITA do faturamento do ML (somente leitura).
// Nao e proxy livre: so monta 3 URLs fixas de /billing/integration com
// parametros validados. Sera removida apos o teste.
//   ?a=periods&group=ML&doc=BILL
//   ?a=details&key=AAAA-MM-DD&group=ML&doc=BILL&limit=50&from=0
//   ?a=summary&key=AAAA-MM-DD&group=ML&doc=BILL
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const a = q.get("a");
  const group = q.get("group") === "MP" ? "MP" : "ML";
  const doc = q.get("doc") === "CREDIT_NOTE" ? "CREDIT_NOTE" : "BILL";
  const key = q.get("key") ?? "";
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 50) || 50, 1), 150);
  const from = Math.max(Number(q.get("from") ?? 0) || 0, 0);
  let path = "";
  if (a === "periods") {
    path = `/billing/integration/monthly/periods?group=${group}&document_type=${doc}&limit=12`;
  } else if ((a === "details" || a === "summary") && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    path =
      a === "details"
        ? `/billing/integration/periods/key/${key}/group/${group}/details?document_type=${doc}&limit=${limit}&from=${from}`
        : `/billing/integration/periods/key/${key}/group/${group}/summary?document_type=${doc}`;
  } else {
    return NextResponse.json({ erro: "parametros invalidos" }, { status: 400 });
  }
  const tk = await getValidMLAccessToken();
  if (!tk) return NextResponse.json({ erro: "sem token" }, { status: 401 });
  const r = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${tk.accessToken}` },
    cache: "no-store",
  });
  const t = await r.text();
  return NextResponse.json({ status: r.status, len: t.length, body: t.slice(0, 4000) });
}
