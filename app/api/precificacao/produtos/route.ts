import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEFAULT_PARAMS, GlobalParams, calcularCusto } from "@/lib/custo";
import {
  ConfigPrecificacao,
  DEFAULT_CONFIG_PRECIFICACAO,
  TipoAnuncioML,
  calcularML,
  calcularShopee,
} from "@/lib/precificacao";
import { CaixaEnvio, ensureCaixasTable, listarCaixas } from "@/lib/caixas";

export const dynamic = "force-dynamic";

async function ensureTable() {
  // Catálogo de caixas de envio (tamanho/preço/fornecedor) -- precisa
  // existir antes das colunas caixa_envio_id abaixo, que referenciam
  // essa tabela.
  await ensureCaixasTable();

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
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS enviado_por_flex_ml BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS embalagem_custo NUMERIC`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS margem_desejada_pct NUMERIC`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS custo_producao_manual NUMERIC`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS ativo_ml BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS ativo_shopee BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS reembolso_flex_ml NUMERIC`;

  // 08/09/2026 (v2) -- Ads/Afiliado por produto (ML + Shopee). Defaults
  // preservam o comportamento anterior: Ads sempre ligado nas duas
  // plataformas, Afiliado Shopee sempre ligado, Afiliado ML desligado
  // (nao existia antes).
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS usa_ads_ml BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS usa_afiliado_ml BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS usa_ads_shopee BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS usa_afiliado_shopee BOOLEAN NOT NULL DEFAULT true`;

  // 14/09/2026 -- anuncio Classico/Premium por produto no ML (afeta a
  // comissao usada no calculo, ver lib/precificacao.ts). Default
  // 'classico' preserva o comportamento anterior (comissao sempre
  // 11,5%) pra qualquer produto que ainda nao tenha esse override.
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS tipo_anuncio_ml TEXT NOT NULL DEFAULT 'classico'`;

  // 14/09/2026 -- marca se o produto e enviado por Mercado Envios Full
  // (ver lib/precificacao.ts pra regra completa, verificada com vendas
  // reais). Default false preserva o comportamento anterior.
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS enviado_por_full BOOLEAN NOT NULL DEFAULT false`;

  // 15/09/2026 -- Preço Anunciado (preço "De", cheio) e Rebate ML
  // (reducao de tarifa que o ML aplica em certas promocoes) por
  // produto. Ver comentario grande no topo de lib/precificacao.ts pra
  // contexto completo (validado direto na conta real do Guilherme).
  // preco_anunciado_ml e so informativo (nao entra em calcularML);
  // rebate_ml entra como parametro explicito e reduz a comissao
  // liquida usada no calculo de margem.
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS preco_anunciado_ml NUMERIC`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS rebate_ml NUMERIC NOT NULL DEFAULT 0`;

  // 18/09/2026 -- caixa de envio escolhida pro SKU (ver lib/caixas.ts).
  // Quando preenchida, o preço da caixa substitui embalagem_custo /
  // embalagemPadrao() no cálculo, e o peso da caixa (quando informado)
  // soma no peso de envio. NULL = continua usando o comportamento
  // antigo (embalagem_custo manual ou embalagemPadrao()).
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS caixa_envio_id INTEGER REFERENCES caixas_envio(id)`;

  // Defensivo: garante a coluna de armazenagem Full em precificacao_config
  // mesmo se essa rota rodar antes de /api/precificacao/config (que tambem
  // faz esse ALTER). Idempotente, nao depende de ordem de chamada.
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
  await sql`ALTER TABLE precificacao_config ADD COLUMN IF NOT EXISTS afiliado_pct_ml NUMERIC NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE precificacao_config ADD COLUMN IF NOT EXISTS armazenagem_full_ml NUMERIC NOT NULL DEFAULT 0`;

  await sql`
    CREATE TABLE IF NOT EXISTS precificacao_sku_virtual (
      id SERIAL PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      peso_envio_kg NUMERIC,
      preco_venda_ml NUMERIC,
      preco_venda_shopee NUMERIC,
      enviado_por_flex_ml BOOLEAN NOT NULL DEFAULT false,
      embalagem_custo NUMERIC,
      margem_desejada_pct NUMERIC,
      custo_producao_manual NUMERIC,
      reembolso_flex_ml NUMERIC,
      ativo_ml BOOLEAN NOT NULL DEFAULT true,
      ativo_shopee BOOLEAN NOT NULL DEFAULT true,
      usa_ads_ml BOOLEAN NOT NULL DEFAULT true,
      usa_afiliado_ml BOOLEAN NOT NULL DEFAULT false,
      usa_ads_shopee BOOLEAN NOT NULL DEFAULT true,
      usa_afiliado_shopee BOOLEAN NOT NULL DEFAULT true,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS usa_ads_ml BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS usa_afiliado_ml BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS usa_ads_shopee BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS usa_afiliado_shopee BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS tipo_anuncio_ml TEXT NOT NULL DEFAULT 'classico'`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS enviado_por_full BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS preco_anunciado_ml NUMERIC`;
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS rebate_ml NUMERIC NOT NULL DEFAULT 0`;
  // 18/09/2026 -- mesma logica de caixa de envio, pro lado dos SKUs
  // "virtuais" (kits/composicoes que so existem via sku_placa).
  await sql`ALTER TABLE precificacao_sku_virtual ADD COLUMN IF NOT EXISTS caixa_envio_id INTEGER REFERENCES caixas_envio(id)`;
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
  enviado_por_flex_ml: boolean | null;
  embalagem_custo: string | null;
  margem_desejada_pct: string | null;
  custo_producao_manual: string | null;
  ativo_ml: boolean | null;
  ativo_shopee: boolean | null;
  reembolso_flex_ml: string | null;
  usa_ads_ml: boolean | null;
  usa_afiliado_ml: boolean | null;
  usa_ads_shopee: boolean | null;
  usa_afiliado_shopee: boolean | null;
  tipo_anuncio_ml: string | null;
  enviado_por_full: boolean | null;
  preco_anunciado_ml: string | null;
  rebate_ml: string | null;
  caixa_envio_id: number | null;
};

type SkuPlacaRow = {
  sku: string;
  pecas_por_unidade: string;
  peso_placa_gramas: string | null;
  tempo_placa_horas: string;
  pecas_por_placa: string;
};

type SkuVirtualOverrideRow = {
  id: number;
  sku: string;
  peso_envio_kg: string | null;
  preco_venda_ml: string | null;
  preco_venda_shopee: string | null;
  enviado_por_flex_ml: boolean | null;
  embalagem_custo: string | null;
  margem_desejada_pct: string | null;
  custo_producao_manual: string | null;
  ativo_ml: boolean | null;
  ativo_shopee: boolean | null;
  reembolso_flex_ml: string | null;
  usa_ads_ml: boolean | null;
  usa_afiliado_ml: boolean | null;
  usa_ads_shopee: boolean | null;
  usa_afiliado_shopee: boolean | null;
  tipo_anuncio_ml: string | null;
  enviado_por_full: boolean | null;
  preco_anunciado_ml: string | null;
  rebate_ml: string | null;
  caixa_envio_id: number | null;
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
  afiliado_pct_ml: string;
  afiliado_pct_shopee: string;
  embalagem_custo: string;
  margem_desejada_pct: string;
  reembolso_flex_ml: string;
  custo_flex_ml: string;
  armazenagem_full_ml: string;
};

function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim();
}

function embalagemPadrao(nome: string, sku: string | null): number {
  const alvo = normalizarTexto(`${nome} ${sku ?? ""}`);
  if (alvo.includes("stam-01") || alvo.includes("stam 01")) return 1.95;
  if (alvo.includes("stam-02") || alvo.includes("stam 02")) return 1.95;
  if (alvo.includes("coracao")) return 1.95;
  return 1.1;
}

function tipoAnuncioMLDeOverride(valor: string | null | undefined): TipoAnuncioML {
  return valor === "premium" ? "premium" : "classico";
}

interface ProdutoPrecificacaoResposta {
  id: number;
  nome: string;
  sku: string;
  custoProducao: number;
  custoProducaoCalculado: number;
  pesoEnvioKg: number;
  embalagemCusto: number;
  caixaEnvioId: number | null;
  margemDesejadaPct: number;
  reembolsoFlexML: number;
  precoVendaML: number | null;
  precoAnunciadoML: number | null;
  rebateML: number;
  precoVendaShopee: number | null;
  enviadoPorFlexML: boolean;
  ativoML: boolean;
  ativoShopee: boolean;
  usaAdsML: boolean;
  usaAfiliadoML: boolean;
  usaAdsShopee: boolean;
  usaAfiliadoShopee: boolean;
  tipoAnuncioML: TipoAnuncioML;
  enviadoPorFull: boolean;
  resultadoML: ReturnType<typeof calcularML> | null;
  resultadoShopee: ReturnType<typeof calcularShopee> | null;
}

export async function GET() {
  await ensureTable();

  const produtosBrutos = (await sql`
    SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
    FROM produtos ORDER BY nome ASC
  `) as ProdutoRow[];
  const RE_PLACA_COMPONENTE_ISOLADA = /-\s*(corpos?|ganchos?)\b/i;
  const produtos = produtosBrutos.filter((p) => {
    const skuLower = (p.sku ?? "").trim().toLowerCase();
    if (skuLower.startsWith("componente:")) return false;
    if (RE_PLACA_COMPONENTE_ISOLADA.test(p.nome ?? "")) return false;
    // 18/09/2026 -- pedido do Guilherme: "Suporte Papel Toalha" (SKU =
    // "SUPORTE PAPEL TOALHA VERDE, SUPORTE PAPEL TOALHA VERDE E
    // DOURADO", cadastrado com 2 SKUs numa unica linha da aba Custo,
    // por ser a MESMA placa usada nas 2 cores) apareceu na Precificação
    // como uma 3a linha estranha: nome/SKU combinados numa unica
    // string E com custo errado (essa linha usa calcularCusto so da
    // placa principal, ignorando a placa "Lateral" adicional do
    // composto). As 2 linhas certas, uma por SKU/cor, ja existem mais
    // abaixo (secao "virtual", via sku_placa) com o custo completo
    // (Base + Lateral). Entao qualquer produto do catalogo com mais de
    // 1 SKU cadastrado junto fica de fora daqui -- ele so aparece pelas
    // linhas virtuais corretas, uma por SKU real.
    const numSkus = (p.sku ?? "")
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
    if (numSkus > 1) return false;
    // 18/09/2026 -- mesmo problema do comentário acima, variante com "+":
    // "Suporte Cortina C (com parafuso)" (produto id 23, placa 103) tem
    // SKU = "PAR DE GANCHOS CORTINA COM PARAFUSO BRANCO/PRETO + Suporte
    // Cortina C Branco 1un/2un" -- um cadastro de placa pra produção
    // (rastreia o par de peças impressas juntas), não uma variação
    // realmente vendida separada. O Guilherme só vende "Suporte Cortina
    // C Branco 1un" e "2un" -- ambos já aparecem certinho como linhas
    // "virtual" (via sku_placa) mais abaixo, com o gancho com parafuso
    // também coberto em linhas virtuais próprias ("PAR DE GANCHOS
    // CORTINA COM PARAFUSO BRANCO/PRETO"). Então qualquer produto com
    // "+" separando SKUs no cadastro também fica de fora daqui, mesma
    // lógica do filtro de vírgula/quebra de linha acima -- não afeta
    // Produção/Estoque, só esconde a linha duplicada da Precificação.
    const numSkusPlus = (p.sku ?? "")
      .split(/\s\+\s/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
    if (numSkusPlus > 1) return false;
    return true;
  });

  const overrides = (await sql`
    SELECT produto_id, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml, usa_ads_ml, usa_afiliado_ml, usa_ads_shopee, usa_afiliado_shopee, tipo_anuncio_ml, enviado_por_full, preco_anunciado_ml, rebate_ml, caixa_envio_id
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
    SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_ml, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml, armazenagem_full_ml
    FROM precificacao_config ORDER BY id DESC LIMIT 1
  `) as ConfigRow[];
  const config: ConfigPrecificacao = configRows.length
    ? {
        impostoPct: Number(configRows[0].imposto_pct),
        adsPctML: Number(configRows[0].ads_pct_ml),
        adsPctShopee: Number(configRows[0].ads_pct_shopee),
        afiliadoPctML: Number(configRows[0].afiliado_pct_ml),
        afiliadoPctShopee: Number(configRows[0].afiliado_pct_shopee),
        embalagemCusto: Number(configRows[0].embalagem_custo),
        margemDesejadaPct: Number(configRows[0].margem_desejada_pct),
        reembolsoFlexML: Number(configRows[0].reembolso_flex_ml),
        custoFlexML: Number(configRows[0].custo_flex_ml),
        armazenagemFullML: Number(configRows[0].armazenagem_full_ml),
      }
    : DEFAULT_CONFIG_PRECIFICACAO;

  // 18/09/2026 -- catálogo de caixas de envio (ver lib/caixas.ts). Um
  // SKU com caixa_envio_id preenchido usa o preço da caixa como custo
  // de embalagem (em vez do embalagem_custo manual ou do default
  // embalagemPadrao()) e soma o peso da caixa (quando informado) no
  // peso de envio.
  const caixas = await listarCaixas();
  const caixaMap = new Map<number, CaixaEnvio>(caixas.map((cx) => [cx.id, cx]));

  const resultado: ProdutoPrecificacaoResposta[] = produtos.map((p) => {
    const custoCalculado = calcularCusto(
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
    const caixaEnvioId = override?.caixa_envio_id ?? null;
    const caixaSelecionada = caixaEnvioId != null ? caixaMap.get(caixaEnvioId) ?? null : null;
    const pesoCaixaKg = caixaSelecionada?.pesoCaixaG != null ? caixaSelecionada.pesoCaixaG / 1000 : 0;
    const pesoEnvioKg =
      override?.peso_envio_kg != null
        ? Number(override.peso_envio_kg)
        : pesoEnvioPadrao + pesoCaixaKg;
    const custoProducao =
      override?.custo_producao_manual != null
        ? Number(override.custo_producao_manual)
        : custoCalculado.custoUnitario;
    const precoVendaML =
      override?.preco_venda_ml != null ? Number(override.preco_venda_ml) : null;
    const precoAnunciadoML =
      override?.preco_anunciado_ml != null ? Number(override.preco_anunciado_ml) : null;
    const rebateML =
      override?.rebate_ml != null ? Number(override.rebate_ml) : 0;
    const precoVendaShopee =
      override?.preco_venda_shopee != null
        ? Number(override.preco_venda_shopee)
        : null;
    const enviadoPorFlexML = override?.enviado_por_flex_ml === true;
    const embalagemCusto = caixaSelecionada
      ? caixaSelecionada.preco
      : override?.embalagem_custo != null
        ? Number(override.embalagem_custo)
        : embalagemPadrao(p.nome, p.sku);
    const reembolsoFlexML =
      override?.reembolso_flex_ml != null
        ? Number(override.reembolso_flex_ml)
        : config.reembolsoFlexML;
    const ativoML = override?.ativo_ml !== false;
    const ativoShopee = override?.ativo_shopee !== false;
    const usaAdsML = override?.usa_ads_ml !== false;
    const usaAfiliadoML = override?.usa_afiliado_ml === true;
    const usaAdsShopee = override?.usa_ads_shopee !== false;
    const usaAfiliadoShopee = override?.usa_afiliado_shopee !== false;
    const tipoAnuncioML = tipoAnuncioMLDeOverride(override?.tipo_anuncio_ml);
    const enviadoPorFull = override?.enviado_por_full === true;

    const resultadoML =
      precoVendaML != null
        ? calcularML(precoVendaML, pesoEnvioKg, custoProducao, embalagemCusto, reembolsoFlexML, config, enviadoPorFlexML, usaAdsML, usaAfiliadoML, tipoAnuncioML, enviadoPorFull, rebateML)
        : null;
    const resultadoShopee =
      precoVendaShopee != null
        ? calcularShopee(precoVendaShopee, custoProducao, embalagemCusto, config, usaAdsShopee, usaAfiliadoShopee)
        : null;

    const margemDesejadaPct =
      override?.margem_desejada_pct != null
        ? Number(override.margem_desejada_pct)
        : Math.round((resultadoML?.margemPct ?? resultadoShopee?.margemPct ?? config.margemDesejadaPct) * 10) / 10;

    return {
      id: p.id,
      nome: p.nome,
      sku: p.sku ?? "",
      custoProducao,
      custoProducaoCalculado: custoCalculado.custoUnitario,
      pesoEnvioKg,
      embalagemCusto,
      caixaEnvioId,
      margemDesejadaPct,
      reembolsoFlexML,
      precoVendaML,
      precoAnunciadoML,
      rebateML,
      precoVendaShopee,
      enviadoPorFlexML,
      ativoML,
      ativoShopee,
      usaAdsML,
      usaAfiliadoML,
      usaAdsShopee,
      usaAfiliadoShopee,
      tipoAnuncioML,
      enviadoPorFull,
      resultadoML,
      resultadoShopee,
    };
  });
  const skuJaEmProdutos = new Set(
    produtos
      .map((p) => (p.sku ? normalizarTexto(p.sku) : null))
      .filter((s): s is string => !!s)
  );

  const linhasSkuPlaca = (await sql`
    SELECT sp.sku, sp.pecas_por_unidade,
           pl.peso_placa_gramas, pl.tempo_placa_horas, pl.pecas_por_placa
    FROM sku_placa sp
    JOIN placas pl ON pl.id = sp.placa_id
    WHERE pl.descontinuada = false
  `) as SkuPlacaRow[];

  const composicaoPorSku = new Map<
    string,
    { skuOriginal: string; custoProducao: number; pesoEnvioKg: number }
  >();
  for (const linha of linhasSkuPlaca) {
    const chave = normalizarTexto(linha.sku);
    if (skuJaEmProdutos.has(chave)) continue;
    if (/^mlb\d+$/i.test(linha.sku.trim())) continue;
    if (/^\d+$/.test(linha.sku.trim())) continue;
    // 18/09/2026 -- mesmo motivo do filtro "+" lá em cima (produto 23
    // "Suporte Cortina C (com parafuso)"): existe uma linha em
    // sku_placa com esse SKU combinado ("... + ...") ligada à placa
    // 103. Antes ela ficava escondida só porque o produto 23 (com o
    // mesmo texto de SKU) já estava em skuJaEmProdutos -- ao tirar o
    // produto 23 da lista normal (filtro acima), essa linha de
    // sku_placa passou a gerar uma linha "virtual" com o MESMO
    // problema (nome/SKU combinado, duplicando "Suporte Cortina C
    // Branco 1un/2un" e "PAR DE GANCHOS CORTINA COM PARAFUSO
    // BRANCO/PRETO" que já aparecem certos em linhas próprias). Então
    // ignora aqui também qualquer linha de sku_placa cujo SKU
    // combine múltiplos itens com "+".
    if (/\s\+\s/.test(linha.sku)) continue;
    const pecasPorPlaca = Number(linha.pecas_por_placa) || 1;
    const custoUnitarioPlaca = calcularCusto(
      {
        pesoPlacaG: Number(linha.peso_placa_gramas ?? 0),
        tempoPlacaH: Number(linha.tempo_placa_horas),
        pecasNaPlaca: pecasPorPlaca,
      },
      params
    ).custoUnitario;
    const pecasPorUnidade = Number(linha.pecas_por_unidade) || 1;
    const pesoUnitarioPlacaKg =
      (Number(linha.peso_placa_gramas ?? 0) / pecasPorPlaca) / 1000;

    const acumulado = composicaoPorSku.get(chave) ?? {
      skuOriginal: linha.sku,
      custoProducao: 0,
      pesoEnvioKg: 0,
    };
    acumulado.custoProducao += custoUnitarioPlaca * pecasPorUnidade;
    acumulado.pesoEnvioKg += pesoUnitarioPlacaKg * pecasPorUnidade;
    composicaoPorSku.set(chave, acumulado);
  }

  if (composicaoPorSku.size > 0) {
    for (const { skuOriginal } of composicaoPorSku.values()) {
      await sql`
        INSERT INTO precificacao_sku_virtual (sku)
        VALUES (${skuOriginal})
        ON CONFLICT (sku) DO NOTHING
      `;
    }
  }

  const virtuaisOverrides = composicaoPorSku.size
    ? ((await sql`
        SELECT id, sku, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml, usa_ads_ml, usa_afiliado_ml, usa_ads_shopee, usa_afiliado_shopee, tipo_anuncio_ml, enviado_por_full, preco_anunciado_ml, rebate_ml, caixa_envio_id
        FROM precificacao_sku_virtual
      `) as SkuVirtualOverrideRow[])
    : [];
  const virtualOverrideMap = new Map(
    virtuaisOverrides.map((v) => [normalizarTexto(v.sku), v])
  );

  const resultadoVirtual: ProdutoPrecificacaoResposta[] = Array.from(
    composicaoPorSku.entries()
  ).map(([chave, calc]) => {
    const override = virtualOverrideMap.get(chave);
    const custoProducaoCalculado = calc.custoProducao;
    const custoProducao =
      override?.custo_producao_manual != null
        ? Number(override.custo_producao_manual)
        : custoProducaoCalculado;
    const caixaEnvioId = override?.caixa_envio_id ?? null;
    const caixaSelecionada = caixaEnvioId != null ? caixaMap.get(caixaEnvioId) ?? null : null;
    const pesoCaixaKg = caixaSelecionada?.pesoCaixaG != null ? caixaSelecionada.pesoCaixaG / 1000 : 0;
    const pesoEnvioKg =
      override?.peso_envio_kg != null
        ? Number(override.peso_envio_kg)
        : calc.pesoEnvioKg + pesoCaixaKg;
    const precoVendaML =
      override?.preco_venda_ml != null ? Number(override.preco_venda_ml) : null;
    const precoAnunciadoML =
      override?.preco_anunciado_ml != null ? Number(override.preco_anunciado_ml) : null;
    const rebateML =
      override?.rebate_ml != null ? Number(override.rebate_ml) : 0;
    const precoVendaShopee =
      override?.preco_venda_shopee != null
        ? Number(override.preco_venda_shopee)
        : null;
    const enviadoPorFlexML = override?.enviado_por_flex_ml === true;
    const embalagemCusto = caixaSelecionada
      ? caixaSelecionada.preco
      : override?.embalagem_custo != null
        ? Number(override.embalagem_custo)
        : embalagemPadrao(calc.skuOriginal, calc.skuOriginal);
    const reembolsoFlexML =
      override?.reembolso_flex_ml != null
        ? Number(override.reembolso_flex_ml)
        : config.reembolsoFlexML;
    const ativoML = override?.ativo_ml !== false;
    const ativoShopee = override?.ativo_shopee !== false;
    const usaAdsML = override?.usa_ads_ml !== false;
    const usaAfiliadoML = override?.usa_afiliado_ml === true;
    const usaAdsShopee = override?.usa_ads_shopee !== false;
    const usaAfiliadoShopee = override?.usa_afiliado_shopee !== false;
    const tipoAnuncioML = tipoAnuncioMLDeOverride(override?.tipo_anuncio_ml);
    const enviadoPorFull = override?.enviado_por_full === true;

    const resultadoML =
      precoVendaML != null
        ? calcularML(precoVendaML, pesoEnvioKg, custoProducao, embalagemCusto, reembolsoFlexML, config, enviadoPorFlexML, usaAdsML, usaAfiliadoML, tipoAnuncioML, enviadoPorFull, rebateML)
        : null;
    const resultadoShopee =
      precoVendaShopee != null
        ? calcularShopee(precoVendaShopee, custoProducao, embalagemCusto, config, usaAdsShopee, usaAfiliadoShopee)
        : null;

    const margemDesejadaPct =
      override?.margem_desejada_pct != null
        ? Number(override.margem_desejada_pct)
        : Math.round((resultadoML?.margemPct ?? resultadoShopee?.margemPct ?? config.margemDesejadaPct) * 10) / 10;

    const idVirtual = override ? -override.id : 0;

    return {
      id: idVirtual,
      nome: calc.skuOriginal,
      sku: calc.skuOriginal,
      custoProducao,
      custoProducaoCalculado,
      pesoEnvioKg,
      embalagemCusto,
      caixaEnvioId,
      margemDesejadaPct,
      reembolsoFlexML,
      precoVendaML,
      precoAnunciadoML,
      rebateML,
      precoVendaShopee,
      enviadoPorFlexML,
      ativoML,
      ativoShopee,
      usaAdsML,
      usaAfiliadoML,
      usaAdsShopee,
      usaAfiliadoShopee,
      tipoAnuncioML,
      enviadoPorFull,
      resultadoML,
      resultadoShopee,
    };
  });

  return NextResponse.json(
    [...resultado, ...resultadoVirtual].sort((a, b) => a.nome.localeCompare(b.nome))
  );
}
export async function PUT(request: NextRequest) {
  await ensureTable();
  const body = await request.json();
  const {
    produtoId,
    sku,
    pesoEnvioKg,
    precoVendaML,
    precoAnunciadoML,
    rebateML,
    precoVendaShopee,
    enviadoPorFlexML,
    embalagemCusto,
    caixaEnvioId,
    margemDesejadaPct,
    custoProducao,
    ativoML,
    ativoShopee,
    reembolsoFlexML,
    usaAdsML,
    usaAfiliadoML,
    usaAdsShopee,
    usaAfiliadoShopee,
    tipoAnuncioML,
    enviadoPorFull,
  } = body as {
    produtoId: number;
    sku?: string | null;
    pesoEnvioKg: number | null;
    precoVendaML: number | null;
    precoAnunciadoML?: number | null;
    rebateML?: number | null;
    precoVendaShopee: number | null;
    enviadoPorFlexML: boolean | null;
    embalagemCusto: number | null;
    caixaEnvioId?: number | null;
    margemDesejadaPct: number | null;
    custoProducao: number | null;
    ativoML: boolean | null;
    ativoShopee: boolean | null;
    reembolsoFlexML: number | null;
    usaAdsML: boolean | null;
    usaAfiliadoML: boolean | null;
    usaAdsShopee: boolean | null;
    usaAfiliadoShopee: boolean | null;
    tipoAnuncioML?: string | null;
    enviadoPorFull?: boolean | null;
  };

  if (produtoId == null) {
    return NextResponse.json({ error: "produtoId e obrigatorio" }, { status: 400 });
  }

  const ativoMLFinal = ativoML !== false;
  const ativoShopeeFinal = ativoShopee !== false;
  const usaAdsMLFinal = usaAdsML !== false;
  const usaAfiliadoMLFinal = usaAfiliadoML === true;
  const usaAdsShopeeFinal = usaAdsShopee !== false;
  const usaAfiliadoShopeeFinal = usaAfiliadoShopee !== false;
  const tipoAnuncioMLFinal = tipoAnuncioML === "premium" ? "premium" : "classico";
  const enviadoPorFullFinal = enviadoPorFull === true;
  const rebateMLFinal = rebateML != null ? rebateML : 0;
  const caixaEnvioIdFinal = caixaEnvioId != null ? caixaEnvioId : null;

  if (produtoId < 0) {
    if (!sku) {
      return NextResponse.json({ error: "sku e obrigatorio para produtos compostos" }, { status: 400 });
    }
    await sql`
      INSERT INTO precificacao_sku_virtual (sku, peso_envio_kg, preco_venda_ml, preco_anunciado_ml, rebate_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, caixa_envio_id, margem_desejada_pct, custo_producao_manual, reembolso_flex_ml, ativo_ml, ativo_shopee, usa_ads_ml, usa_afiliado_ml, usa_ads_shopee, usa_afiliado_shopee, tipo_anuncio_ml, enviado_por_full, atualizado_em)
      VALUES (${sku}, ${pesoEnvioKg}, ${precoVendaML}, ${precoAnunciadoML ?? null}, ${rebateMLFinal}, ${precoVendaShopee}, ${enviadoPorFlexML === true}, ${embalagemCusto}, ${caixaEnvioIdFinal}, ${margemDesejadaPct}, ${custoProducao}, ${reembolsoFlexML}, ${ativoMLFinal}, ${ativoShopeeFinal}, ${usaAdsMLFinal}, ${usaAfiliadoMLFinal}, ${usaAdsShopeeFinal}, ${usaAfiliadoShopeeFinal}, ${tipoAnuncioMLFinal}, ${enviadoPorFullFinal}, now())
      ON CONFLICT (sku) DO UPDATE
      SET peso_envio_kg = ${pesoEnvioKg},
          preco_venda_ml = ${precoVendaML},
          preco_anunciado_ml = ${precoAnunciadoML ?? null},
          rebate_ml = ${rebateMLFinal},
          preco_venda_shopee = ${precoVendaShopee},
          enviado_por_flex_ml = ${enviadoPorFlexML === true},
          embalagem_custo = ${embalagemCusto},
          caixa_envio_id = ${caixaEnvioIdFinal},
          margem_desejada_pct = ${margemDesejadaPct},
          custo_producao_manual = ${custoProducao},
          reembolso_flex_ml = ${reembolsoFlexML},
          ativo_ml = ${ativoMLFinal},
          ativo_shopee = ${ativoShopeeFinal},
          usa_ads_ml = ${usaAdsMLFinal},
          usa_afiliado_ml = ${usaAfiliadoMLFinal},
          usa_ads_shopee = ${usaAdsShopeeFinal},
          usa_afiliado_shopee = ${usaAfiliadoShopeeFinal},
          tipo_anuncio_ml = ${tipoAnuncioMLFinal},
          enviado_por_full = ${enviadoPorFullFinal},
          atualizado_em = now()
    `;
    return NextResponse.json({ ok: true });
  }

  await sql`
    INSERT INTO precificacao_produtos (produto_id, peso_envio_kg, preco_venda_ml, preco_anunciado_ml, rebate_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, caixa_envio_id, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml, usa_ads_ml, usa_afiliado_ml, usa_ads_shopee, usa_afiliado_shopee, tipo_anuncio_ml, enviado_por_full, atualizado_em)
    VALUES (${produtoId}, ${pesoEnvioKg}, ${precoVendaML}, ${precoAnunciadoML ?? null}, ${rebateMLFinal}, ${precoVendaShopee}, ${enviadoPorFlexML === true}, ${embalagemCusto}, ${caixaEnvioIdFinal}, ${margemDesejadaPct}, ${custoProducao}, ${ativoMLFinal}, ${ativoShopeeFinal}, ${reembolsoFlexML}, ${usaAdsMLFinal}, ${usaAfiliadoMLFinal}, ${usaAdsShopeeFinal}, ${usaAfiliadoShopeeFinal}, ${tipoAnuncioMLFinal}, ${enviadoPorFullFinal}, now())
    ON CONFLICT (produto_id) DO UPDATE
    SET peso_envio_kg = ${pesoEnvioKg},
        preco_venda_ml = ${precoVendaML},
        preco_anunciado_ml = ${precoAnunciadoML ?? null},
        rebate_ml = ${rebateMLFinal},
        preco_venda_shopee = ${precoVendaShopee},
        enviado_por_flex_ml = ${enviadoPorFlexML === true},
        embalagem_custo = ${embalagemCusto},
        caixa_envio_id = ${caixaEnvioIdFinal},
        margem_desejada_pct = ${margemDesejadaPct},
        custo_producao_manual = ${custoProducao},
        ativo_ml = ${ativoMLFinal},
        ativo_shopee = ${ativoShopeeFinal},
        reembolso_flex_ml = ${reembolsoFlexML},
        usa_ads_ml = ${usaAdsMLFinal},
        usa_afiliado_ml = ${usaAfiliadoMLFinal},
        usa_ads_shopee = ${usaAdsShopeeFinal},
        usa_afiliado_shopee = ${usaAfiliadoShopeeFinal},
        tipo_anuncio_ml = ${tipoAnuncioMLFinal},
        enviado_por_full = ${enviadoPorFullFinal},
        atualizado_em = now()
  `;

  return NextResponse.json({ ok: true });
}
