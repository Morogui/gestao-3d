// Logica de calculo de precificacao por plataforma (Mercado Livre e Shopee).
//
// Baseado em auditoria de dados reais feita em 19/08/2026 direto na
// Central de Vendedores do ML e no seller center da Shopee (nao em
// blogs/tabelas genericas) -- ver planilha "PRECIFICACAO CERTA" pra
// contexto completo da investigacao.
//
// Pontos ainda pendentes de confirmacao do Guilherme (ficam com valor
// default editavel na config, mas nao sao um calculo "fechado" ainda):
//   - % de comissao de afiliados na Shopee (se ele participar do programa)
//   - custo real de embalagem/caixa
//   - aliquota exata de imposto (confirmar com a contadora, CF Contabil)
//   - reembolso e custo real do Mercado Envios Flex: Guilherme confirmou
//     que o ML reembolsa uma parte e ele tem um custo real que paga pelo
//     Flex, diferente do que a auditoria anterior (8 pedidos) sugeria.
//     Ele esta levantando os valores exatos -- default R$0 editavel.

export interface ConfigPrecificacao {
      impostoPct: number;
      adsPctML: number;
      adsPctShopee: number;
      afiliadoPctShopee: number;
      embalagemCusto: number;
      margemDesejadaPct: number;
      reembolsoFlexML: number;
      custoFlexML: number;
}

export const DEFAULT_CONFIG_PRECIFICACAO: ConfigPrecificacao = {
      impostoPct: 6,
      adsPctML: 5,
      adsPctShopee: 10,
      afiliadoPctShopee: 0,
      embalagemCusto: 1.1,
      margemDesejadaPct: 20,
      reembolsoFlexML: 0,
      custoFlexML: 0,
};

// Comissao do anuncio Classico no Mercado Livre. Confirmada em 19/08/2026
// lendo o breakdown real da Tarifa de venda de varios anuncios do
// Guilherme -- deu 11,49% a 11,50% em todos os pontos de preco testados.
export const COMISSAO_ML_CLASSICO_PCT = 11.5;

// Tarifa fixa por peso do Mercado Livre. Substituiu a antiga taxa fixa
// de R$6,75 em 2/mar/2026 -- agora e calculada por peso cubado (o maior
// entre peso real e peso volumetrico, C x L x A / 6000) cruzado com faixa
// de preco. O ML nao expoe essa tabela completa por API publica, entao
// essas faixas foram calibradas com pontos reais colhidos nos proprios
// anuncios do Guilherme em 19/08/2026: 0,48kg deu R$6,65 a R$7,85, itens
// medios deram R$6,95 a R$8,55. E a melhor aproximacao disponivel sem a
// tabela oficial completa -- mais precisa pra itens leves (a maioria do
// catalogo), mais incerta pra itens acima de 1,5kg (extrapolado).
export function taxaPesoML(pesoKg: number): number {
      if (!pesoKg || pesoKg <= 0.3) return 6.5;
      if (pesoKg <= 0.6) return 6.65;
      if (pesoKg <= 1) return 7.5;
      if (pesoKg <= 1.5) return 8;
      if (pesoKg <= 2.5) return 9.5;
      return 12;
}

// Comissao + tarifa fixa da Shopee. Confirmada igual a regra oficial 2026
// (lida direto da formula da planilha PRECIFICACAO CERTA, aba SHOPEE).
export function comissaoShopeePct(preco: number): number {
      return preco < 80 ? 20 : 14;
}

export function taxaFixaShopee(preco: number): number {
      if (preco < 80) return 4;
      if (preco < 100) return 16;
      if (preco < 200) return 20;
      return 26;
}

export interface ResultadoPlataforma {
      preco: number;
      comissao: number;
      taxaFixa: number;
      imposto: number;
      ads: number;
      afiliado: number;
      embalagem: number;
      flexCusto: number;
      custoProducao: number;
      lucro: number;
      margemPct: number;
}

export function calcularML(
      preco: number,
      pesoKg: number,
      custoProducao: number,
      config: ConfigPrecificacao,
      enviadoPorFlex: boolean = false
    ): ResultadoPlataforma {
      const comissao = preco * (COMISSAO_ML_CLASSICO_PCT / 100);
      const taxaFixa = taxaPesoML(pesoKg);
      const imposto = preco * (config.impostoPct / 100);
      const ads = preco * (config.adsPctML / 100);
      const embalagem = config.embalagemCusto;
      const flexCusto = enviadoPorFlex
        ? Math.max(0, config.custoFlexML - config.reembolsoFlexML)
              : 0;
      const lucro =
              preco - comissao - taxaFixa - imposto - ads - embalagem - flexCusto - custoProducao;
      const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
      return {
              preco,
              comissao,
              taxaFixa,
              imposto,
              ads,
              afiliado: 0,
              embalagem,
              flexCusto,
              custoProducao,
              lucro,
              margemPct,
      };
}

export function calcularShopee(
      preco: number,
      custoProducao: number,
      config: ConfigPrecificacao
    ): ResultadoPlataforma {
      const comissao = preco * (comissaoShopeePct(preco) / 100);
      const taxaFixa = taxaFixaShopee(preco);
      const imposto = preco * (config.impostoPct / 100);
      const ads = preco * (config.adsPctShopee / 100);
      const afiliado = preco * (config.afiliadoPctShopee / 100);
      const embalagem = config.embalagemCusto;
      const lucro =
              preco -
              comissao -
              taxaFixa -
              imposto -
              ads -
              afiliado -
              embalagem -
              custoProducao;
      const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
      return {
              preco,
              comissao,
              taxaFixa,
              imposto,
              ads,
              afiliado,
              embalagem,
              flexCusto: 0,
              custoProducao,
              lucro,
              margemPct,
      };
}

export function formatBRL(value: number): string {
      if (Number.isNaN(value) || !Number.isFinite(value)) return "R$ 0,00";
      return value.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
      });
}
