// Sincronizacao AUTOMATICA do investimento em Ads (Shopee Ads e Mercado Ads)
// direto das APIs das plataformas, gravando em ads_investimento_diario
// (a mesma tabela que o card "Investimento em Ads" da aba Vendas ja le).
//
// Shopee: /api/v2/ads/get_all_cpc_ads_daily_performance (testado ao vivo em
// 2026-11-13: devolve expense, direct/broad GMV, cliques, impressoes por dia).
// Mercado Livre: Product Ads API (/advertising/...). Em 2026-11-13 devolveu
// 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES -> o app do ML ainda nao tem
// permissao de Product Ads. Enquanto isso o valor do ML continua manual e
// esta funcao NAO escreve nada do ML (evita sobrescrever com zero).
import { cookies } from "next/headers";
import { sql } from "./db";
import { refreshAccessToken, signAuthenticatedRequest } from "./shopee";
import { getValidMLAccessToken } from "./ml-auth";

async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS ads_investimento_diario (
      id SERIAL PRIMARY KEY,
      dia DATE NOT NULL,
      plataforma TEXT NOT NULL CHECK (plataforma IN ('ml', 'shopee')),
      valor NUMERIC NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(dia, plataforma)
    )
  `;
  await sql`ALTER TABLE ads_investimento_diario ADD COLUMN IF NOT EXISTS receita_atribuida NUMERIC`;
  await sql`ALTER TABLE ads_investimento_diario ADD COLUMN IF NOT EXISTS cliques INT`;
  await sql`ALTER TABLE ads_investimento_diario ADD COLUMN IF NOT EXISTS impressoes INT`;
  await sql`ALTER TABLE ads_investimento_diario ADD COLUMN IF NOT EXISTS origem TEXT`;
}

export interface ResultadoSyncAds {
  shopee: { ok: boolean; motivo?: string; dias?: { dia: string; gasto: number; receita: number }[] };
  ml: { ok: boolean; motivo?: string };
}

function diasEntre(de: string, ate: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  while (cur <= fim) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function sincronizarShopee(de: string, ate: string): Promise<ResultadoSyncAds["shopee"]> {
  const store = cookies();
  const shopIdStr = store.get("shopee_shop_id")?.value;
  if (!shopIdStr) return { ok: false, motivo: "Shopee desconectada" };
  const shopId = Number(shopIdStr);
  let access = store.get("shopee_access_token")?.value;
  if (!access) {
    const rt = store.get("shopee_refresh_token")?.value;
    if (rt) {
      const n = await refreshAccessToken(rt, shopId);
      if (n) {
        access = n.access_token;
        try {
          const opt = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
          store.set("shopee_access_token", n.access_token, { ...opt, maxAge: n.expire_in });
          store.set("shopee_refresh_token", n.refresh_token, { ...opt, maxAge: 60 * 60 * 24 * 30 });
        } catch {}
      }
    }
  }
  if (!access) return { ok: false, motivo: "sessao Shopee expirada" };

  const dd = (iso: string) => iso.split("-").reverse().join("-");
  const url =
    signAuthenticatedRequest("/api/v2/ads/get_all_cpc_ads_daily_performance", access, shopId) +
    `&start_date=${dd(de)}&end_date=${dd(ate)}`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) return { ok: false, motivo: `Shopee HTTP ${resp.status}` };
  const data = await resp.json();
  if (data?.error) return { ok: false, motivo: `Shopee: ${data.error} ${data.message ?? ""}`.trim() };

  const lista: {
    date: string;
    expense?: number;
    broad_gmv?: number;
    clicks?: number;
    impression?: number;
  }[] = Array.isArray(data?.response) ? data.response : [];

  const porDia = new Map<string, { gasto: number; receita: number; cliques: number; imp: number }>();
  for (const r of lista) {
    // "12-11-2026" -> "2026-11-12"
    const [d, m, a] = String(r.date).split("-");
    if (!d || !m || !a) continue;
    porDia.set(`${a}-${m}-${d}`, {
      gasto: Number(r.expense ?? 0),
      receita: Number(r.broad_gmv ?? 0),
      cliques: Number(r.clicks ?? 0),
      imp: Number(r.impression ?? 0),
    });
  }

  const dias: { dia: string; gasto: number; receita: number }[] = [];
  for (const dia of diasEntre(de, ate)) {
    const v = porDia.get(dia) ?? { gasto: 0, receita: 0, cliques: 0, imp: 0 };
    await sql`
      INSERT INTO ads_investimento_diario
        (dia, plataforma, valor, receita_atribuida, cliques, impressoes, origem, atualizado_em)
      VALUES (${dia}::date, 'shopee', ${v.gasto}, ${v.receita}, ${v.cliques}, ${v.imp}, 'api', now())
      ON CONFLICT (dia, plataforma) DO UPDATE SET
        valor = ${v.gasto},
        receita_atribuida = ${v.receita},
        cliques = ${v.cliques},
        impressoes = ${v.imp},
        origem = 'api',
        atualizado_em = now()
    `;
    dias.push({ dia, gasto: v.gasto, receita: v.receita });
  }
  return { ok: true, dias };
}

// ML: so verifica se a permissao de Product Ads ja foi liberada. Quando
// liberar, a escrita sera ligada aqui (formato da resposta a confirmar).
async function statusML(): Promise<ResultadoSyncAds["ml"]> {
  try {
    const tk = await getValidMLAccessToken();
    if (!tk) return { ok: false, motivo: "ML desconectado" };
    const r = await fetch("https://api.mercadolibre.com/advertising/advertisers?product_id=PADS", {
      headers: { Authorization: `Bearer ${tk.accessToken}`, "Api-Version": "1" },
      cache: "no-store",
    });
    if (r.status === 403) return { ok: false, motivo: "app do ML sem permissao de Product Ads" };
    if (!r.ok) return { ok: false, motivo: `ML HTTP ${r.status}` };
    return { ok: false, motivo: "permissao liberada, falta ligar a leitura de custos" };
  } catch (e) {
    return { ok: false, motivo: String(e) };
  }
}

export async function sincronizarAds(de: string, ate: string): Promise<ResultadoSyncAds> {
  await garantirTabela();
  const [shopee, ml] = await Promise.all([
    sincronizarShopee(de, ate).catch((e) => ({ ok: false, motivo: String(e) })),
    statusML(),
  ]);
  return { shopee, ml };
}
