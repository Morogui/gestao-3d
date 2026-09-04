import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { getValidShopeeAccessToken } from "@/lib/shopee-auth";
import { signAuthenticatedRequest } from "@/lib/shopee";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// Rota temporaria de diagnostico -- pedido do Guilherme em 04/09/2026:
// preencher manualmente o preco de venda real (ML + Shopee) de cada
// produto na aba Precificacao, sem ainda automatizar a busca (isso fica
// pra depois). Essa rota so LE os precos reais de cada anuncio ativo
// (nao escreve nada) pra eu conseguir casar cada anuncio com o produto
// certo no catalogo e preencher via PUT /api/precificacao/produtos.
// Remover depois de usada (mesmo padrao de outras rotas de debug do
// projeto).

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
    const limit = 100;
    let offset = 0;
    for (;;) {
          const resp = await fetch(
                  `${ML_API_BASE}/users/${userId}/items/search?status=active&limit=${limit}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
                );
          if (!resp.ok) break;
          const data = await resp.json();
          const results: string[] = data?.results ?? [];
          ids.push(...results);
          const total: number = data?.paging?.total ?? results.length;
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
        try {
                const resp = await fetch(
                          `${ML_API_BASE}/items?ids=${batch.join(",")}&attributes=id,title,seller_custom_field,price,variations`,
                  { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
                        );
                if (!resp.ok) continue;
                const data = await resp.json();
                for (const entry of data ?? []) {
                          if (entry?.code !== 200 || !entry.body?.id) continue;
                          const body = entry.body;
                          const variacoesRaw: any[] = body.variations ?? [];
                          const variacoes: MLVariacao[] = variacoesRaw.map((v) => {
                                      const skuAttr = (v.attribute_combinations ?? []).find(
                                                    (a: any) => a.id === "SELLER_SKU"
                                                  );
                                      return {
                                                    id: v.id,
                                                    sku: v.seller_custom_field ?? skuAttr?.value_name ?? "",
                                                    price: v.price ?? null,
                                      };
                          });
                          itens.push({
                                      itemId: body.id,
                                      title: body.title ?? "",
                                      sku: body.seller_custom_field ?? "",
                                      price: body.price ?? null,
                                      variacoes,
                          });
                }
        } catch (err) {
                console.error("[precos-atuais] erro ao buscar lote ML:", err);
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
    let more = true;
    let guard = 0;
    while (more && guard < 20) {
          guard++;
          const url = new URL(
                  signAuthenticatedRequest("/api/v2/product/get_item_list", accessToken, shopId)
                );
          url.searchParams.set("offset", String(offset));
          url.searchParams.set("page_size", "100");
          url.searchParams.set("item_status", "NORMAL");
          const resp = await fetch(url.toString(), { cache: "no-store" });
          if (!resp.ok) break;
          const data = await resp.json();
          const list: { item_id: number }[] = data?.response?.item ?? [];
          for (const it of list) if (it.item_id) itemIds.push(it.item_id);
          more = Boolean(data?.response?.has_next_page);
          offset += 100;
    }

  const itens: ShopeePrecoItem[] = [];
    for (let i = 0; i < itemIds.length; i += 50) {
          const batch = itemIds.slice(i, i + 50);
          try {
                  const url = new URL(
                            signAuthenticatedRequest("/api/v2/product/get_item_base_info", accessToken, shopId)
                          );
                  url.searchParams.set("item_id_list", batch.join(","));
                  const resp = await fetch(url.toString(), { cache: "no-store" });
                  if (!resp.ok) continue;
                  const data = await resp.json();
                  const list: any[] = data?.response?.item_list ?? [];
                  for (const item of list) {
                            const price = item?.price_info?.[0]?.current_price ?? null;
                            itens.push({
                                        itemId: item.item_id,
                                        sku: item.item_sku ?? "",
                                        title: item.item_name ?? "",
                                        price,
                            });
                  }
          } catch (err) {
                  console.error("[precos-atuais] erro ao buscar lote Shopee:", err);
          }
    }

  return { connected: true, itens };
}

export async function GET() {
    const [ml, shopee] = await Promise.all([buscarPrecosML(), buscarPrecosShopee()]);
    return NextResponse.json({ ml, shopee });
}
