// Precificacao TikTok Shop (Brasil).
//
// Fonte oficial: Central do Vendedor -> Academia -> "Tarifa de Comissao da
// Plataforma" (https://seller-br.tiktok.com/university/essay?knowledge_id=24428156307201),
// vigente desde 15/07/2026, conferida em 28/10/2026:
//   - preco do item apos descontos do vendedor < R$ 50,00  -> comissao 10% + R$ 4,00 por item
//   - preco do item apos descontos do vendedor >= R$ 50,00 -> comissao  6% + R$ 6,00 por item
// A comissao e a taxa por item sao calculadas sobre o preco apos desconto
// do vendedor (desconto bancado pela plataforma nao entra na base).
//
// Programa de Frete Gratis: taxa de servico adicional (soma com a comissao,
// nao substitui), ~6% do preco com teto de R$ 50 por item. Esse % e o teto
// vem de fontes secundarias (a pagina oficial do programa nao esta na
// Academia publica) -- por isso ficam editaveis na tela e marcados como
// "confirmar" ate conferir na demonstracao financeira de um pedido real.
//
// Comissao de afiliado (criador): definida pelo vendedor, cobrada a parte
// da tarifa da plataforma. Ads (TikTok Ads/GMV Max): % medio do preco.

export interface ConfigTikTok {
  adsPct: number;
  afiliadoPct: number;
  fretePct: number;
  freteTeto: number;
}

export const DEFAULT_CONFIG_TIKTOK: ConfigTikTok = {
  adsPct: 5,
  afiliadoPct: 10,
  fretePct: 6,
  freteTeto: 50,
};

export const LIMITE_FAIXA_TIKTOK = 50;

export function comissaoTikTokPct(preco: number): number {
  return preco < LIMITE_FAIXA_TIKTOK ? 10 : 6;
}

export function taxaFixaTikTok(preco: number): number {
  return preco < LIMITE_FAIXA_TIKTOK ? 4 : 6;
}

export interface ResultadoTikTok {
  preco: number;
  comissaoPct: number;
  comissao: number;
  taxaFixa: number;
  imposto: number;
  ads: number;
  afiliado: number;
  frete: number;
  embalagem: number;
  custoProducao: number;
  lucro: number;
  margemPct: number;
}

export function calcularTikTok(
  preco: number,
  custoProducao: number,
  embalagemCusto: number,
  impostoPct: number,
  config: ConfigTikTok,
  usaAds: boolean,
  usaAfiliado: boolean,
  usaFrete: boolean
): ResultadoTikTok {
  const comissaoPct = comissaoTikTokPct(preco);
  const comissao = preco * (comissaoPct / 100);
  const taxaFixa = taxaFixaTikTok(preco);
  const imposto = preco * (impostoPct / 100);
  const ads = usaAds ? preco * (config.adsPct / 100) : 0;
  const afiliado = usaAfiliado ? preco * (config.afiliadoPct / 100) : 0;
  const frete = usaFrete
    ? Math.min(preco * (config.fretePct / 100), config.freteTeto)
    : 0;
  const lucro =
    preco -
    comissao -
    taxaFixa -
    imposto -
    ads -
    afiliado -
    frete -
    embalagemCusto -
    custoProducao;
  const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
  return {
    preco,
    comissaoPct,
    comissao,
    taxaFixa,
    imposto,
    ads,
    afiliado,
    frete,
    embalagem: embalagemCusto,
    custoProducao,
    lucro,
    margemPct,
  };
}

// Preco minimo pra bater a margem alvo (% do preco). Resolve as duas
// faixas (< R$ 50 e >= R$ 50) e devolve o menor preco consistente com a
// faixa em que ele cai. Considera o teto do frete gratis.
export function precoParaMargemTikTok(
  margemAlvoPct: number,
  custoProducao: number,
  embalagemCusto: number,
  impostoPct: number,
  config: ConfigTikTok,
  usaAds: boolean,
  usaAfiliado: boolean,
  usaFrete: boolean
): number | null {
  const m = margemAlvoPct / 100;
  const pctVar = (comissaoPct: number, comFrete: boolean) =>
    comissaoPct / 100 +
    impostoPct / 100 +
    (usaAds ? config.adsPct / 100 : 0) +
    (usaAfiliado ? config.afiliadoPct / 100 : 0) +
    (comFrete ? config.fretePct / 100 : 0) +
    m;

  const resolverFaixa = (comissaoPct: number, taxaFixa: number): number | null => {
    const fixo = taxaFixa + embalagemCusto + custoProducao;
    // 1) frete como percentual (abaixo do teto)
    let denom = 1 - pctVar(comissaoPct, usaFrete);
    if (denom > 0) {
      const p = fixo / denom;
      if (!usaFrete || p * (config.fretePct / 100) <= config.freteTeto) return p;
    }
    // 2) frete travado no teto
    if (usaFrete) {
      denom = 1 - pctVar(comissaoPct, false);
      if (denom > 0) return (fixo + config.freteTeto) / denom;
    }
    return null;
  };

  const p1 = resolverFaixa(10, 4);
  if (p1 != null && p1 < LIMITE_FAIXA_TIKTOK) return Math.ceil(p1 * 100) / 100;
  const p2 = resolverFaixa(6, 6);
  if (p2 == null) return null;
  // Na faixa >= 50 o preco minimo nunca fica abaixo de 50.
  return Math.ceil(Math.max(p2, LIMITE_FAIXA_TIKTOK) * 100) / 100;
}
