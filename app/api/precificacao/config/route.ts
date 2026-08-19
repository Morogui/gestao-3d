import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
    ConfigPrecificacao,
    DEFAULT_CONFIG_PRECIFICACAO,
} from "@/lib/precificacao";

export const dynamic = "force-dynamic";

async function ensureTable() {
    await sql`
      CREATE TABLE IF NOT EXISTS precificacao_config (
        id SERIAL PRIMARY KEY,
          imposto_pct NUMERIC NOT NULL DEFAULT 6,
            ads_pct_ml NUMERIC NOT NULL DEFAULT 5,
              ads_pct_shopee NUMERIC NOT NULL DEFAULT 10,
                afiliado_pct_shopee NUMERIC NOT NULL DEFAULT 0,
                  embalagem_custo NUMERIC NOT NULL DEFAULT 1.1,
                    margem_desejada_pct NUMERIC NOT NULL DEFAULT 20,
                      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                        )
                          `;
    await sql`ALTER TABLE precificacao_config ADD COLUMN IF NOT EXISTS reembolso_flex_ml NUMERIC NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE precificacao_config ADD COLUMN IF NOT EXISTS custo_flex_ml NUMERIC NOT NULL DEFAULT 0`;
}

type ConfigRow = {
    imposto_pct: string;
    ads_pct_ml: string;
    ads_pct_shopee: string;
    afiliado_pct_shopee: string;
    embalagem_custo: string;
    margem_desejada_pct: string;
    reembolso_flex_ml: string;
    custo_flex_ml: string;
};

function toConfig(row: ConfigRow): ConfigPrecificacao {
    return {
          impostoPct: Number(row.imposto_pct),
          adsPctML: Number(row.ads_pct_ml),
          adsPctShopee: Number(row.ads_pct_shopee),
          afiliadoPctShopee: Number(row.afiliado_pct_shopee),
          embalagemCusto: Number(row.embalagem_custo),
          margemDesejadaPct: Number(row.margem_desejada_pct),
          reembolsoFlexML: Number(row.reembolso_flex_ml),
          custoFlexML: Number(row.custo_flex_ml),
    };
}

export async function GET() {
    await ensureTable();
    const rows = (await sql`
      SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml
        FROM precificacao_config ORDER BY id DESC LIMIT 1
          `) as ConfigRow[];
    if (rows.length === 0) return NextResponse.json(DEFAULT_CONFIG_PRECIFICACAO);
    return NextResponse.json(toConfig(rows[0]));
}

export async function PUT(request: NextRequest) {
    await ensureTable();
    const body = (await request.json()) as ConfigPrecificacao;
    const {
          impostoPct,
          adsPctML,
          adsPctShopee,
          afiliadoPctShopee,
          embalagemCusto,
          margemDesejadaPct,
          reembolsoFlexML,
          custoFlexML,
    } = body;

const existing = (await sql`
SELECT id FROM precificacao_config ORDER BY id DESC LIMIT 1
`) as { id: number }[];

let rows: ConfigRow[];
    if (existing.length > 0) {
          rows = (await sql`
              UPDATE precificacao_config
                  SET imposto_pct = ${impostoPct},
                      ads_pct_ml = ${adsPctML},
                          ads_pct_shopee = ${adsPctShopee},
                              afiliado_pct_shopee = ${afiliadoPctShopee},
                                  embalagem_custo = ${embalagemCusto},
                                      margem_desejada_pct = ${margemDesejadaPct},
                                          reembolso_flex_ml = ${reembolsoFlexML},
                                              custo_flex_ml = ${custoFlexML},
                                                  atualizado_em = now()
                                                      WHERE id = ${existing[0].id}
                                                          RETURNING imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml
                                                              `) as ConfigRow[];
    } else {
          rows = (await sql`
              INSERT INTO precificacao_config (imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml)
                  VALUES (${impostoPct}, ${adsPctML}, ${adsPctShopee}, ${afiliadoPctShopee}, ${embalagemCusto}, ${margemDesejadaPct}, ${reembolsoFlexML}, ${custoFlexML})
                      RETURNING imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml
                          `) as ConfigRow[];
    }
    return NextResponse.json(toConfig(rows[0]));
}
