import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getValidMLAccessToken();
  if (!auth) {
    return NextResponse.json({ ok: false, erro: "ML nao conectado" }, { status: 401 });
  }

  const ids = ["MLB7565415242", "MLB5167313615"];
  const resultados: Record<string, unknown> = {};

  for (const id of ids) {
    const r = await fetch(`https://api.mercadolibre.com/items/${id}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    const j = await r.json();
    resultados[id] = {
      status: r.status,
      title: j.title,
      seller_custom_field: j.seller_custom_field,
      inventory_id: j.inventory_id,
      variations: j.variations,
      attributes: j.attributes,
    };
  }

  return NextResponse.json({ ok: true, resultados });
}
