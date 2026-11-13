// Cálculo de margem real por pedido — cruza o preço de venda (já temos
// na aba Vendas) com o custo de produção (Custo Produto 3D) e as mesmas
// taxas/formulas já usadas na aba Precificação (comissão, tarifa por
// peso, imposto, embalagem), pra saber quanto sobrou de verdade em cada
// venda. Pedido do Guilherme em 2026-09-08.
//
// 2026-11-13 (pedido do Guilherme):
//   - Tarifa de venda REAL: quando o pedido ML traz order.saleFee
//     (order_items[].sale_fee), usa esse valor em vez da estimativa por
//     tabela (comissão % + tarifa por peso).
//   - Reembolso do Flex ("Bônus por envio"): só existe em pedidos da
//     modalidade FLEX. A API pública do ML NÃO traz esse valor por pedido
//     (não está no pagamento, nem no faturamento, nem no custo do envio —
//     só aparece como crédito solto "CASHBACK" no extrato do Mercado
//     Pago, sem número de pedido). Por isso o bônus entra como ESTIMADO
//     (FLEX_BONUS_ESTIMADO ou config.reembolsoFlexML, se preenchido) e a
//     margem do pedido Flex é marcada com flexEstimado = true. Média real
//     de outubro/2026: R$ 10,80 por pedido (104 créditos, R$ 1.125,81).
//
// O que este arquivo NÃO tenta resolver:
//   - Custo real do Full no ML (CUSTO_FULL_ML = 0 até levantar o valor).
//   - Ads/Afiliado por pedido individual: a API de pedidos não diz se UM
//     pedido veio de anúncio. A margem "real" NÃO desconta Ads/Afiliado;
//     vai junto um segundo número "com Ads/Afiliado (estimado)".
//   - Custo de produção de kit/composto sem SKU calculado: o item entra
//     em `itensSemCusto` e a margem do pedido fica parcial.

import { sql } from "./db";
import { DEFAULT_PARAMS, GlobalParams, calcularCusto } from "./custo";
import {
  ConfigPrecificacao,
  DEFAULT_CONFIG_PRECIFICACAO,
  COMISSAO_ML_CLASSICO_PCT,
  taxaPesoML,
  comissaoShopeePct,
  taxaFixaShopee,
} from "./precificacao";
import { OrderSummary } from "./ml-orders";

// Custo extra de envio Full no ML — ver nota no topo do arquivo.
export const CUSTO_FULL_ML = 0;

// Bônus por envio do Flex (estorno) — média real de outubro/2026 (R$ 7,99
// a R$ 10,99 por pedido). Só vale pra pedidos Flex.
export const FLEX_BONUS_ESTIMADO = 10.8;

export function pedidoEhFlex(order: OrderSummary): boolean {
  return order.plataforma === "ml" && /flex/i.test(order.shippingMode ?? "");
}

export interface CustoSkuInfo {
  nome: string;
  custoUnitario: number;
  pesoEnvioKg: number;
}

interface ProdutoRow {
  id: number;
  nome: string;
  sku: string;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
}

interface ParametrosRow {
  preco_filamento_kg: string;
  energia_hora: string;
  manutencao_hora: string;
  falha_impressao: string;
}

interface OverrideRow {
  produto_id: number;
  peso_envio_kg: string | null;
}

interface ConfigRow {
  imposto_pct: string;
  ads_pct_ml: string;
  ads_pct_shopee: string;
  afiliado_pct_shopee: string;
  embalagem_custo: string;
  margem_desejada_pct: string;
}

// Mapa SKU -> custo unitário/peso de envio (mesma fonte da Precificação).
export async function getCustoPorSku(): Promise<Map<string, CustoSkuInfo>> {
  const produtos = (await sql`
    SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
    FROM produtos
    WHERE sku IS NOT NULL AND sku <> ''
  `) as ProdutoRow[];

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

  let overrides: OverrideRow[] = [];
  try {
    overrides = (await sql`
      SELECT produto_id, peso_envio_kg FROM precificacao_produtos
    `) as OverrideRow[];
  } catch {
    overrides = [];
  }
  const overrideMap = new Map(overrides.map((o) => [o.produto_id, o]));

  const mapa = new Map<string, CustoSkuInfo>();
  for (const p of produtos) {
    const custo = calcularCusto(
      {
        pesoPlacaG: Number(p.peso_placa_g),
        tempoPlacaH: Number(p.tempo_placa_h),
        pecasNaPlaca: Number(p.pecas_na_placa),
      },
      params
    );
    const pecas = Number(p.pecas_na_placa) || 1;
    const pesoEnvioPadrao = Number(p.peso_placa_g) / pecas / 1000;
    const override = overrideMap.get(p.id);
    const pesoEnvioKg =
      override?.peso_envio_kg != null
        ? Number(override.peso_envio_kg)
        : pesoEnvioPadrao;
    mapa.set(p.sku, {
      nome: p.nome,
      custoUnitario: custo.custoUnitario,
      pesoEnvioKg,
    });
  }
  return mapa;
}

// Mesma config usada na aba Precificação.
export async function getConfigPrecificacao(): Promise<ConfigPrecificacao> {
  try {
    const rows = (await sql`
      SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct
      FROM precificacao_config ORDER BY id DESC LIMIT 1
    `) as ConfigRow[];
    if (!rows.length) return DEFAULT_CONFIG_PRECIFICACAO;
    return {
      impostoPct: Number(rows[0].imposto_pct),
      adsPctML: Number(rows[0].ads_pct_ml),
      adsPctShopee: Number(rows[0].ads_pct_shopee),
      afiliadoPctML: DEFAULT_CONFIG_PRECIFICACAO.afiliadoPctML,
      afiliadoPctShopee: Number(rows[0].afiliado_pct_shopee),
      embalagemCusto: Number(rows[0].embalagem_custo),
      margemDesejadaPct: Number(rows[0].margem_desejada_pct),
      reembolsoFlexML: DEFAULT_CONFIG_PRECIFICACAO.reembolsoFlexML,
      custoFlexML: DEFAULT_CONFIG_PRECIFICACAO.custoFlexML,
      armazenagemFullML: DEFAULT_CONFIG_PRECIFICACAO.armazenagemFullML,
    };
  } catch {
    return DEFAULT_CONFIG_PRECIFICACAO;
  }
}

export interface MargemPedido {
  order: OrderSummary;
  custoProdutoTotal: number;
  pesoTotalKg: number;
  itensSemCusto: string[];
  comissao: number;
  taxaFixa: number;
  imposto: number;
  embalagem: number;
  custoEnvioExtra: number;
  margemReal: number;
  margemPct: number;
  adsEstimado: number;
  afiliadoEstimado: number;
  margemComAdsEstimado: number;
  // true = tarifa de venda é a real do ML (order.saleFee); false = estimada
  tarifaReal: boolean;
  // Bônus por envio do Flex somado à margem (0 se o pedido não é Flex)
  flexBonus: number;
  // true = o bônus Flex é estimado (a API não traz o valor por pedido)
  flexEstimado: boolean;
  // Custo do envio Flex pago por nós (config.custoFlexML), já descontado
  custoFlex: number;
}

// Margem real de UM pedido já vendido (passar só pedidos filtrados por
// pedidoFoiVendido). Itens sem SKU cadastrado entram em `itensSemCusto`
// e deixam a margem do pedido marcada como parcial.
export function calcularMargemPedido(
  order: OrderSummary,
  custoPorSku: Map<string, CustoSkuInfo>,
  config: ConfigPrecificacao
): MargemPedido {
  let custoProdutoTotal = 0;
  let pesoTotalKg = 0;
  const itensSemCusto: string[] = [];

  for (const item of order.items) {
    const info = item.hasCustomSku ? custoPorSku.get(item.sku) : undefined;
    if (info) {
      custoProdutoTotal += info.custoUnitario * item.quantity;
      pesoTotalKg += info.pesoEnvioKg * item.quantity;
    } else {
      itensSemCusto.push(item.sku && item.sku !== "—" ? item.sku : item.title);
    }
  }

  const preco = order.totalAmount;
  let comissao: number;
  let taxaFixa: number;
  let tarifaReal = false;
  if (order.plataforma === "ml") {
    if (order.saleFee != null && order.saleFee > 0) {
      // Tarifa real cobrada pelo ML (comissão + custo fixo juntos)
      comissao = order.saleFee;
      taxaFixa = 0;
      tarifaReal = true;
    } else {
      comissao = preco * (COMISSAO_ML_CLASSICO_PCT / 100);
      taxaFixa = taxaPesoML(pesoTotalKg);
    }
  } else {
    comissao = preco * (comissaoShopeePct(preco) / 100);
    taxaFixa = taxaFixaShopee(preco);
  }
  const imposto = preco * (config.impostoPct / 100);
  const embalagem = config.embalagemCusto;
  const custoEnvioExtra =
    order.plataforma === "ml" && order.shippingMode === "Full" ? CUSTO_FULL_ML : 0;

  // Flex: só nesses pedidos existe o bônus por envio (estorno do ML) e o
  // custo do entregador. Os dois são parametrizáveis na Precificação.
  const ehFlex = pedidoEhFlex(order);
  const flexBonus = ehFlex
    ? config.reembolsoFlexML > 0
      ? config.reembolsoFlexML
      : FLEX_BONUS_ESTIMADO
    : 0;
  const custoFlex = ehFlex ? config.custoFlexML : 0;

  const margemReal =
    preco -
    comissao -
    taxaFixa -
    imposto -
    embalagem -
    custoProdutoTotal -
    custoEnvioExtra -
    custoFlex +
    flexBonus;
  const margemPct = preco > 0 ? (margemReal / preco) * 100 : 0;

  const adsPct = order.plataforma === "ml" ? config.adsPctML : config.adsPctShopee;
  const adsEstimado = preco * (adsPct / 100);
  const afiliadoEstimado =
    order.plataforma === "shopee" ? preco * (config.afiliadoPctShopee / 100) : 0;
  const margemComAdsEstimado = margemReal - adsEstimado - afiliadoEstimado;

  return {
    order,
    custoProdutoTotal,
    pesoTotalKg,
    itensSemCusto,
    comissao,
    taxaFixa,
    imposto,
    embalagem,
    custoEnvioExtra,
    margemReal,
    margemPct,
    adsEstimado,
    afiliadoEstimado,
    margemComAdsEstimado,
    tarifaReal,
    flexBonus,
    flexEstimado: ehFlex,
    custoFlex,
  };
}
