import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ROTA TEMPORARIA — sonda RESTRITA (somente leitura) do faturamento do ML,
// grupos ML | MP | FLEX. Nao e proxy livre. Sera removida apos o teste.
//   ?a=periods&group=FLEX
//   ?a=details&group=FLEX&key=AAAA-MM-DD&limit=3
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const g = q.get("group");
  const group = g === "MP" ? "MP" : g === "FLEX" ? "FLEX" : "ML";
  const a = q.get("a");
  const key = q.get("key") ?? "";
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 3) || 3, 1), 150);
  let path = "";
  if (a === "periods") {
    path = `/billing/integration/monthly/periods?group=${group}&document_type=BILL&limit=12`;
  } else if (a === "details" && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    path = `/billing/integration/periods/key/${key}/group/${group}/details?document_type=BILL&limit=${limit}`;
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
  return NextResponse.json({ status: r.status, len: t.length, body: t.slice(0, 3500) });
}
