import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEFAULT_PARAMS, GlobalParams, calcularCusto } from "@/lib/custo";
import {
  ConfigPrecificacao,
  DEFAULT_CONFIG_PRECIFICACAO,
  calcularML,
  calcularShopee,
} from "@/lib/precificacao";

export const dynamic = "force-dynamic";

async function ensureTable() {
  await sql`
  CREATE TABLE IF NOT EXISTS precificacao_produtos (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  peso_envio_kg NUMERIC,
  preco_venda_ml NUMERIC,
  preco_venda_shopee NUMERIC,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(produto_id)
  )
  `;
}

type ProdutoRow = {
  id: number;
  nome: string;
  sku: string | null;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
};

type OverrideRow = {
  produto_id: number;
  peso_envio_kg: string | null;
  preco_venda_ml: string | null;
  preco_venda_shopee: string | null;
};

type ParametrosRow = {
  preco_filamento_kg: string;
  energia_hora: string;
  manutencao_hora: string;
  falha_impressao: string;
};

type ConfigRow = {
  imposto_pct: string;
  ads_pct_ml: string;
  ads_pct_shopee: string;
  afiliado_pct_shopee: string;
  embalagem_custo: string;
  margem_desejada_pct: string;
};

export async function GET() {
  await ensureTable();
  
  const produtos = (await sql`
  SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
  FROM produtos ORDER BY nome ASC
  `) as ProdutoRow[];
  
  const overrides = (await sql`
  SELECT produto_id, peso_envio_kg, preco_venda_ml, preco_venda_shopee
  FROM precificacao_produtos
  `) as OverrideRow[];
  const overrideMap = new Map(overrides.map((o) => [o.produto_id, o]));
  
  const paramRows = (await sql`
  SELECT preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
  FROM parametros_globais ORDER BY id DESC LIMIT 1
  `) as ParametrosRow[];
  const params: GlobalParams = paramRows.length
    ? {
      precoFilamentoKg: Number(paramRows[0].preco_filamento_kg),
      energiaHora: Number(paramRows[0].energia_hora),
      manutencaoHora: Number(paramRows[0].manutencao_hora),
      falhaImpressao: Number(paramRows[0].falha_impressao),
    }
    : DEFAULT_PARAMS;
  
  const configRows = (await sql`
  SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct
  FROM precificacao_config ORDER BY id DESC LIMIT 1
  `) as ConfigRow[];
  const config: ConfigPrecificacao = configRows.length
    ? {
      impostoPct: Number(configRows[0].imposto_pct),
      adsPctML: Number(configRows[0].ads_pct_ml),
      adsPctShopee: Number(configRows[0].ads_pct_shopee),
      afiliadoPctShopee: Number(configRows[0].afiliado_pct_shopee),
      embalagemCusto: Number(configRows[0].embalagem_custo),
      margemDesejadaPct: Number(configRows[0].margem_desejada_pct),
    }
    : DEFAULT_CONFIG_PRECIFICACAO;
  
  const resultado = produtos.map((p) => {
    const custo = calcularCusto(
      {
        pesoPlacaG: Number(p.peso_placa_g),
        tempoPlacaH: Number(p.tempo_placa_h),
        pecasNaPlaca: Number(p.pecas_na_placa),
      },
      params
      );
    
    const override = overrideMap.get(p.id);
    const pecas = Number(p.pecas_na_placa) || 1;
    const pesoEnvioPadrao = Number(p.peso_placa_g) / pecas / 1000;
    const pesoEnvioKg =
      override?.peso_envio_kg != null
      ? Number(override.peso_envio_kg)
      : pesoEnvioPadrao;
    const precoVendaML =
      override?.preco_venda_ml != null ? Number(override.preco_venda_ml) : null;
    const precoVendaShopee =
      override?.preco_venda_shopee != null
      ? Number(override.preco_venda_shopee)
      : null;
    
    const resultadoML =
      precoVendaML != null
      ? calcularML(precoVendaML, pesoEnvioKg, custo.custoUnitario, config)
      : null;
    const resultadoShopee =
      precoVendaShopee != null
      ? calcularShopee(precoVendaShopee, custo.custoUnitario, config)
      : null;
    
    return {
      id: p.id,
      nome: p.nome,
      sku: p.sku ?? "",
      custoProducao: custo.custoUnitario,
      pesoEnvioKg,
      precoVendaML,
      precoVendaShopee,
      resultadoML,
      resultadoShopee,
    };
  });
  
  return NextResponse.json(resultado);
}

export async function PUT(request: NextRequest) {
  await ensureTable();
  const body = await request.json();
  const { produtoId, pesoEnvioKg, precoVendaML, precoVendaShopee } = body as {
    produtoId: number;
    pesoEnvioKg: number | null;
    precoVendaML: number | null;
    precoVendaShopee: number | null;
  };
  
  if (!produtoId) {
    return NextResponse.json({ error: "produtoId e obrigatorio" }, { status: 400 });
  }
  
  await sql`
  INSERT INTO precificacao_produtos (produto_id, peso_envio_kg, preco_venda_ml, preco_venda_shopee, atualizado_em)
  VALUES (${produtoId}, ${pesoEnvioKg}, ${precoVendaML}, ${precoVendaShopee}, now())
  ON CONFLICT (produto_id) DO UPDATE
  SET peso_envio_kg = ${pesoEnvioKg},
  preco_venda_ml = ${precoVendaML},
  preco_venda_shopee = ${precoVendaShopee},
  atualizado_em = now()
  `;
  
  return NextResponse.json({ ok: true });
}
