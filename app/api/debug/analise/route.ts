import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// v2 -- pedido do Guilherme em 2026-08-15: o painel real da ML mostra
// 37 anuncios (com variacoes de cor DENTRO de cada um, no fluxo nativo
// da ML), mas a aba Analise mostra 75. Testa se agrupar por
// user_product_id (o campo oficial da ML pra variacao nativa) bate com
// os 37 reais, em vez do agrupamento por nome de catalogo que a aba usa
// hoje. Remover depois de usar.
async function buscarTodosItemIds(userId: string, accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const resp = await fetch(
      `${ML_API_BASE}/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );
    if (!resp.ok) throw new Error(`items/search respondeu ${resp.status}`);
    const data = await resp.json();
    const results: string[] = data?.results ?? [];
    ids.push(...results);
    const total: number = data?.paging?.total ?? results.length;
    offset += limit;
    if (results.length === 0 || offset >= total || offset >= 1000) break;
  }
  return ids;
}

export async function GET() {
  try {
    const auth = await getValidMLAccessToken();
    if (!auth) return NextResponse.json({ connected: false });
    const { accessToken, userId } = auth;
    const itemIds = await buscarTodosItemIds(userId, accessToken);

    const info = new Map<string, { userProductId: string | null; title: string; variationsCount: number; status: string | null }>();
    await Promise.all(
      itemIds.map(async (itemId) => {
        try {
          const resp = await fetch(`${ML_API_BASE}/items/${itemId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store",
          });
          if (!resp.ok) { info.set(itemId, { userProductId: null, title: "?", variationsCount: 0, status: null }); return; }
          const data = await resp.json();
          info.set(itemId, {
            userProductId: data?.user_product_id ?? null,
            title: data?.title ?? "",
            variationsCount: Array.isArray(data?.variations) ? data.variations.length : 0,
            status: data?.status ?? null,
          });
        } catch {
          info.set(itemId, { userProductId: null, title: "?", variationsCount: 0, status: null });
        }
      })
    );

    const groupsByUserProduct = new Map<string, string[]>();
    for (const [itemId, v] of info.entries()) {
      const key = v.userProductId || `item:${itemId}`;
      const list = groupsByUserProduct.get(key) ?? [];
      list.push(itemId);
      groupsByUserProduct.set(key, list);
    }

    const withNativeVariations = Array.from(info.values()).filter((v) => v.variationsCount > 0).length;
    const withUserProductId = Array.from(info.values()).filter((v) => v.userProductId).length;
    const statusCounts: Record<string, number> = {};
    for (const v of info.values()) {
      const s = v.status ?? "null";
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    return NextResponse.json({
      totalItemIds: itemIds.length,
      totalGroupsByUserProductId: groupsByUserProduct.size,
      itemsWithNativeVariations: withNativeVariations,
      itemsWithUserProductId: withUserProductId,
      statusCounts,
      groupsBiggerThan1: Array.from(groupsByUserProduct.entries())
        .filter(([, v]) => v.length > 1)
        .map(([k, v]) => ({ key: k, count: v.length, titles: v.map((id) => info.get(id)?.title) })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
      { status: 500 }
    );
  }
}
