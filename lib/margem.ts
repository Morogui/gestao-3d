// Cálculo de margem real por pedido — cruza o preço de venda (já temos
// na aba Vendas) com o custo de produção (Custo Produto 3D) e as mesmas
// taxas/formulas já usadas na aba Precificação (comissão, tarifa por
// peso, imposto, embalagem), pra saber quanto sobrou de verdade em cada
// venda. Pedido do Guilherme em 2026-09-08.
//
// O que este arquivo NÃO tenta resolver (e por quê):
//   - Custo real do Full no Mercado Livre: ainda não temos o valor exato
//     que a ML cobra de armazenagem/fulfillment do Full (mesma situação
//     do "Custo Flex ML" na Precificação, que também ficou em R$0 até o
//     Guilherme levantar o número real). CUSTO_FULL_ML abaixo fica em
//     R$0 por padrão — ajustável aqui quando esse valor aparecer.
//   - Ads/Afiliado por pedido individual: a API de pedidos da ML/Shopee
//     não diz se UM pedido específico veio de anúncio patrocinado ou
//     não (isso só existe nos relatórios de Ads, que ainda não estão
//     integrados ao sistema — ver lib/ads-investimento.ts). Por isso a
//     margem "real" abaixo NÃO desconta Ads/Afiliado — ela é o número
//     confiável. Vai junto um segundo número "com Ads/Afiliado
//     (estimado)" usando o mesmo % médio configurado na Precificação,
//     só como referência — não é o custo real daquele pedido específico.
//   - Custo de produção de linhas de kit/composto: herda a mesma
//     limitação já conhecida na Precificação (ver tarefa em aberto sobre
//     custoProducao de linhas compostas) — se o catálogo ainda não tiver
//     o SKU do kit calculado corretamente, o item entra em
//     `itensSemCusto` e a margem do pedido fica marcada como parcial.

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

// Monta um mapa SKU -> custo unitário/peso de envio, cruzando o catálogo
// (produtos), os parâmetros de custo (parametros_globais) e os overrides
// de peso de envio já cadastrados na Precificação (precificacao_produtos)
// — mesma fonte de dados que a aba Precificação usa, pra os dois lugares
// baterem o mesmo número.
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
    // tabela pode não existir ainda em algum ambiente — segue sem overrides
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

// Mesma config usada na aba Precificação (imposto, % de ads médio, %
// afiliado médio, embalagem) — reaproveitada aqui pra não duplicar
// número/fonte de verdade entre as duas telas.
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
}

// Calcula a margem real de UM pedido já vendido (ver pedidoFoiVendido em
// lib/ml-orders.ts — passar só pedidos já filtrados pra cá). Soma o
// custo de produção de cada item pelo SKU batido no catálogo; itens sem
// SKU cadastrado (ainda não confirmado na aba Custo/Precificação) entram
// em `itensSemCusto` e NÃO travam o cálculo dos outros itens do mesmo
// pedido — só deixam a margem daquele pedido marcada como parcial.
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
  if (order.plataforma === "ml") {
    comissao = preco * (COMISSAO_ML_CLASSICO_PCT / 100);
    taxaFixa = taxaPesoML(pesoTotalKg);
  } else {
    comissao = preco * (comissaoShopeePct(preco) / 100);
    taxaFixa = taxaFixaShopee(preco);
  }
  const imposto = preco * (config.impostoPct / 100);
  const embalagem = config.embalagemCusto;
  const custoEnvioExtra =
    order.plataforma === "ml" && order.shippingMode === "Full" ? CUSTO_FULL_ML : 0;

  const margemReal =
    preco -
    comissao -
    taxaFixa -
    imposto -
    embalagem -
    custoProdutoTotal -
    custoEnvioExtra;
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
  };
}
