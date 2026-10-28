import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ConfigTikTok, DEFAULT_CONFIG_TIKTOK } from "@/lib/precificacao-tiktok";

export const dynamic = "force-dynamic";

// 28/10/2026 -- aba TikTok da Precificacao. Guarda so o que e especifico
// do TikTok Shop (preco praticado, ativo, toggles de Ads/Afiliado/Frete
// gratis por SKU + parametros globais). Custo de producao, embalagem e
// imposto continuam vindo de /api/precificacao/produtos e da config geral.
async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS precificacao_tiktok (
      sku TEXT PRIMARY KEY,
      preco_venda NUMERIC,
      ativo BOOLEAN NOT NULL DEFAULT true,
      usa_ads BOOLEAN NOT NULL DEFAULT false,
      usa_afiliado BOOLEAN NOT NULL DEFAULT false,
      usa_frete BOOLEAN NOT NULL DEFAULT false,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE precificacao_tiktok ADD COLUMN IF NOT EXISTS preco_cheio NUMERIC`;
  await sql`
    CREATE TABLE IF NOT EXISTS precificacao_tiktok_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      ads_pct NUMERIC NOT NULL DEFAULT 5,
      afiliado_pct NUMERIC NOT NULL DEFAULT 10,
      frete_pct NUMERIC NOT NULL DEFAULT 6,
      frete_teto NUMERIC NOT NULL DEFAULT 50,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

type ItemRow = {
  sku: string;
  preco_cheio: string | null;
  preco_venda: string | null;
  ativo: boolean;
  usa_ads: boolean;
  usa_afiliado: boolean;
  usa_frete: boolean;
};

type ConfigRow = {
  ads_pct: string;
  afiliado_pct: string;
  frete_pct: string;
  frete_teto: string;
};

async function lerConfig(): Promise<ConfigTikTok> {
  const rows = (await sql`
    SELECT ads_pct, afiliado_pct, frete_pct, frete_teto
    FROM precificacao_tiktok_config WHERE id = 1
  `) as ConfigRow[];
  if (!rows.length) return DEFAULT_CONFIG_TIKTOK;
  return {
    adsPct: Number(rows[0].ads_pct),
    afiliadoPct: Number(rows[0].afiliado_pct),
    fretePct: Number(rows[0].frete_pct),
    freteTeto: Number(rows[0].frete_teto),
  };
}

export async function GET() {
  await ensureTables();
  const config = await lerConfig();
  const rows = (await sql`
    SELECT sku, preco_cheio, preco_venda, ativo, usa_ads, usa_afiliado, usa_frete
    FROM precificacao_tiktok
  `) as ItemRow[];
  const itens = rows.map((r) => ({
    sku: r.sku,
    precoCheio: r.preco_cheio != null ? Number(r.preco_cheio) : null,
    precoVenda: r.preco_venda != null ? Number(r.preco_venda) : null,
    ativo: r.ativo !== false,
    usaAds: r.usa_ads === true,
    usaAfiliado: r.usa_afiliado === true,
    usaFrete: r.usa_frete === true,
  }));
  return NextResponse.json({ config, itens });
}

export async function PUT(request: NextRequest) {
  await ensureTables();
  const body = await request.json();

  if (body && body.config) {
    const cfg = body.config as ConfigTikTok;
    await sql`
      INSERT INTO precificacao_tiktok_config (id, ads_pct, afiliado_pct, frete_pct, frete_teto, atualizado_em)
      VALUES (1, ${cfg.adsPct}, ${cfg.afiliadoPct}, ${cfg.fretePct}, ${cfg.freteTeto}, now())
      ON CONFLICT (id) DO UPDATE
      SET ads_pct = ${cfg.adsPct},
          afiliado_pct = ${cfg.afiliadoPct},
          frete_pct = ${cfg.fretePct},
          frete_teto = ${cfg.freteTeto},
          atualizado_em = now()
    `;
    return NextResponse.json({ ok: true, config: await lerConfig() });
  }

  const { sku, precoCheio, precoVenda, ativo, usaAds, usaAfiliado, usaFrete } = body as {
    sku?: string;
    precoCheio?: number | null;
    precoVenda?: number | null;
    ativo?: boolean;
    usaAds?: boolean;
    usaAfiliado?: boolean;
    usaFrete?: boolean;
  };
  if (!sku) {
    return NextResponse.json({ error: "sku e obrigatorio" }, { status: 400 });
  }
  const preco = precoVenda != null ? precoVenda : null;
  const cheio = precoCheio != null ? precoCheio : null;
  const ativoFinal = ativo !== false;
  const adsFinal = usaAds === true;
  const afiliadoFinal = usaAfiliado === true;
  const freteFinal = usaFrete === true;
  await sql`
    INSERT INTO precificacao_tiktok (sku, preco_cheio, preco_venda, ativo, usa_ads, usa_afiliado, usa_frete, atualizado_em)
    VALUES (${sku}, ${cheio}, ${preco}, ${ativoFinal}, ${adsFinal}, ${afiliadoFinal}, ${freteFinal}, now())
    ON CONFLICT (sku) DO UPDATE
    SET preco_cheio = ${cheio},
        preco_venda = ${preco},
        ativo = ${ativoFinal},
        usa_ads = ${adsFinal},
        usa_afiliado = ${afiliadoFinal},
        usa_frete = ${freteFinal},
        atualizado_em = now()
  `;
  return NextResponse.json({ ok: true });
}
