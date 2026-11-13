import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { refreshAccessToken, signAuthenticatedRequest } from "@/lib/shopee";

export const dynamic = "force-dynamic";

// ROTA TEMPORARIA de diagnostico das APIs de Ads (ML Product Ads e
// Shopee Ads). Devolve a resposta CRUA de cada endpoint pra descobrir o
// formato real antes de construir a sincronizacao. Sera removida depois.
//
// GET /api/ads/diagnostico?de=YYYY-MM-DD&ate=YYYY-MM-DD
export async function GET(request: NextRequest) {
  const de = request.nextUrl.searchParams.get("de") ?? "2026-11-12";
  const ate = request.nextUrl.searchParams.get("ate") ?? de;
  const out: Record<string, unknown> = { de, ate };

  // ---------- Mercado Livre ----------
  try {
    const tk = await getValidMLAccessToken();
    if (!tk) {
      out.ml = { erro: "sem token ML" };
    } else {
      const h1 = { Authorization: `Bearer ${tk.accessToken}`, "Api-Version": "1" };
      const r1 = await fetch(
        "https://api.mercadolibre.com/advertising/advertisers?product_id=PADS",
        { headers: h1, cache: "no-store" }
      );
      const t1 = await r1.text();
      const ml: Record<string, unknown> = { advertisers_status: r1.status, advertisers: t1.slice(0, 1500) };
      let advId: string | null = null;
      let siteId = "MLB";
      try {
        const j = JSON.parse(t1);
        const a = (j.advertisers ?? j.results ?? [])[0];
        if (a) {
          advId = String(a.advertiser_id ?? a.id);
          siteId = a.site_id ?? "MLB";
        }
      } catch {}
      if (advId) {
        const h2 = { Authorization: `Bearer ${tk.accessToken}`, "Api-Version": "2" };
        const metrics = "clicks,prints,ctr,cost,cpc,acos,roas,direct_amount,indirect_amount,total_amount,units_quantity";
        const q = `date_from=${de}&date_to=${ate}&metrics=${metrics}&limit=50&offset=0`;
        const urls: Record<string, string> = {
          a_search_mkt: `https://api.mercadolibre.com/marketplace/advertising/${siteId}/advertisers/${advId}/product_ads/campaigns/search?${q}&metrics_summary=true`,
          b_search_mkt_daily: `https://api.mercadolibre.com/marketplace/advertising/${siteId}/advertisers/${advId}/product_ads/campaigns/search?${q}&aggregation_type=DAILY`,
          c_search_adv: `https://api.mercadolibre.com/advertising/${siteId}/advertisers/${advId}/product_ads/campaigns/search?${q}&metrics_summary=true`,
          d_old: `https://api.mercadolibre.com/advertising/advertisers/${advId}/product_ads/campaigns?${q}&metrics_summary=true`,
        };
        for (const [k, u] of Object.entries(urls)) {
          const r = await fetch(u, { headers: h2, cache: "no-store" });
          const t = await r.text();
          ml[k + "_status"] = r.status;
          ml[k] = t.slice(0, 3500);
        }
      }
      out.ml = ml;
    }
  } catch (e) {
    out.ml = { erro: String(e) };
  }

  // ---------- Shopee ----------
  try {
    const store = cookies();
    const shopIdStr = store.get("shopee_shop_id")?.value;
    let access = store.get("shopee_access_token")?.value;
    if (!shopIdStr) {
      out.shopee = { erro: "sem shop_id (Shopee desconectada)" };
    } else {
      const shopId = Number(shopIdStr);
      if (!access) {
        const rt = store.get("shopee_refresh_token")?.value;
        if (rt) {
          const n = await refreshAccessToken(rt, shopId);
          if (n) access = n.access_token;
        }
      }
      if (!access) {
        out.shopee = { erro: "sem access_token" };
      } else {
        const dd = (iso: string) => iso.split("-").reverse().join("-");
        const sh: Record<string, unknown> = {};
        const chamadas: Record<string, string> = {
          saldo: signAuthenticatedRequest("/api/v2/ads/get_total_balance", access, shopId),
          diario:
            signAuthenticatedRequest("/api/v2/ads/get_all_cpc_ads_daily_performance", access, shopId) +
            `&start_date=${dd(de)}&end_date=${dd(ate)}`,
        };
        for (const [k, u] of Object.entries(chamadas)) {
          const r = await fetch(u, { cache: "no-store" });
          const t = await r.text();
          sh[k + "_status"] = r.status;
          sh[k] = t.slice(0, 3000);
        }
        out.shopee = sh;
      }
    }
  } catch (e) {
    out.shopee = { erro: String(e) };
  }

  return NextResponse.json(out);
}
