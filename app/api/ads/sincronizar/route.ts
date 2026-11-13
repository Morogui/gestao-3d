import { NextRequest, NextResponse } from "next/server";
import { sincronizarAds } from "@/lib/ads-sync";

export const dynamic = "force-dynamic";

function hojeBRT(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function diasAtras(n: number): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - n * 86400000).toISOString().slice(0, 10);
}

// GET /api/ads/sincronizar?de=YYYY-MM-DD&ate=YYYY-MM-DD
// Sem parametros: ultimos 7 dias ate hoje (fuso Brasilia).
export async function GET(request: NextRequest) {
  const de = request.nextUrl.searchParams.get("de") ?? diasAtras(6);
  const ate = request.nextUrl.searchParams.get("ate") ?? hojeBRT();
  const r = await sincronizarAds(de, ate);
  return NextResponse.json({ de, ate, ...r });
}
