import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { getValidShopeeAccessToken } from "@/lib/shopee-auth";
import { signAuthenticatedRequest } from "@/lib/shopee";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

interface MLVariacao {
  id: number;
  sku: string;
  price: number | null;
}
interface MLPrecoItem {
  itemId: string;
  title: string;
  sku: string;
  price: number | null;
  variacoes: MLVariacao[];
}

async function buscarTodosItemIds(userId: string, accessToken: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const r = await fetch(`${ML_API_BASE}/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const j = await r.json();
    const results: string[] = j.results || [];
    ids.push(...results);
    const total = j.paging?.total ?? 0;
    offset += limit;
    if (results.length === 0 || offset >= total || offset >= 1000) break;
  }
  return ids;
}

async function buscarPrecosML(): Promise<{ connected: boolean; itens: MLPrecoItem[] }> {
  const sessao = await getValidMLAccessToken();
  if (!sessao) return { connected: false, itens: [] };
  const { accessToken, userId } = sessao;
  const ids = await buscarTodosItemIds(userId, accessToken);
  const itens: MLPrecoItem[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const r = await fetch(`${ML_API_BASE}/items?ids=${batch.join(",")}&attributes=id,title,seller_custom_field,price,variations`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const arr = await r.json();
    for (const entry of arr) {
      if (entry.code !== 200) continue;
      const body = entry.body;
      const variacoes: MLVariacao[] = (body.variations || []).map((v: any) => {
        const skuAttr = (v.attribute_combinations || []).find((a: any) => a.id === "SELLER_SKU");
        return {
          id: v.id,
          sku: v.seller_custom_field ?? skuAttr?.value_name ?? "",
          price: v.price ?? null,
        };
      });
      itens.push({
        itemId: body.id,
        title: body.title,
        sku: body.seller_custom_field ?? "",
        price: body.price ?? null,
        variacoes,
      });
    }
  }
  return { connected: true, itens };
}

interface ShopeePrecoItem {
  itemId: number;
  sku: string;
  title: string;
  price: number | null;
}

async function buscarPrecosShopee(): Promise<{ connected: boolean; itens: ShopeePrecoItem[] }> {
  const sessao = await getValidShopeeAccessToken();
  if (!sessao) return { connected: false, itens: [] };
  const { accessToken, shopId } = sessao;
  const itemIds: number[] = [];
  let offset = 0;
  let guard = 0;
  while (guard < 20) {
    guard++;
    const { url, headers } = signAuthenticatedRequest(`/api/v2/product/get_item_list?offset=${offset}&page_size=100&item_status=NORMAL`, accessToken, shopId);
    const r = await fetch(url, { headers });
    const j = await r.json();
    const items = j.response?.item || [];
    for (const it of items) itemIds.push(it.item_id);
    if (!j.response?.has_next_page) break;
    offset += 100;
  }
  const itens: ShopeePrecoItem[] = [];
  for (let i = 0; i < itemIds.length; i += 50) {
    const batch = itemIds.slice(i, i + 50);
    const { url, headers } = signAuthenticatedRequest(`/api/v2/product/get_item_base_info?item_id_list=${batch.join(",")}`, accessToken, shopId);
    const r = await fetch(url, { headers });
    const j = await r.json();
    const list = j.response?.item_list || [];
    for (const item of list) {
      itens.push({
        itemId: item.item_id,
        sku: item.item_sku ?? "",
        title: item.item_name ?? "",
        price: item?.price_info?.[0]?.current_price ?? null,
      });
    }
  }
  return { connected: true, itens };
}

export async function GET() {
  const [ml, shopee] = await Promise.all([buscarPrecosML(), buscarPrecosShopee()]);
  return NextResponse.json({ ml, shopee });
}
