// Lógica de cálculo de custo de impressão 3D
// Fórmula (conforme definido pelo usuário):
//
// Custo Filamento   = (peso da placa em g ÷ 1000) × preço do filamento (R$/kg)
// Custo Energia     = tempo da placa (h) × energia (R$/h)
// Custo Manutenção  = tempo da placa (h) × manutenção (R$/h)
// Custo da Placa    = Custo Filamento + Custo Energia + Custo Manutenção
// Custo da Placa c/ Falha = Custo da Placa × (1 + falha de impressão)
// Custo unitário (por peça) = Custo da Placa c/ Falha ÷ peças na placa
//
// Esta calculadora cobra o custo da peça solta. A montagem de kits/SKUs
// (várias peças formando um produto vendido) é resolvida depois, na aba
// de Vendas/Produção, multiplicando o custo unitário de cada peça pela
// composição do kit.

export interface GlobalParams {
  /** R$ por kg de filamento */
  precoFilamentoKg: number;
  /** R$ por hora de energia */
  energiaHora: number;
  /** R$ por hora de manutenção */
  manutencaoHora: number;
  /** Percentual de falha de impressão, ex: 0.03 = 3% */
  falhaImpressao: number;
}

export const DEFAULT_PARAMS: GlobalParams = {
  precoFilamentoKg: 75.4,
  energiaHora: 0.08,
  manutencaoHora: 0.3,
  falhaImpressao: 0.03,
};

export interface ProdutoInput {
  id: string;
  /** nome ou código do produto — serve como identificador para busca/filtro */
  nome: string;
  /** SKU do produto (opcional) — pra identificar/cruzar com vendas */
  sku: string;
  /** peso da placa inteira, em gramas */
  pesoPlacaG: number;
  /** tempo de impressão da placa, em horas */
  tempoPlacaH: number;
  /** quantas peças saem em uma placa */
  pecasNaPlaca: number;
}

export interface CustoBreakdown {
  custoFilamento: number;
  custoEnergia: number;
  custoManutencao: number;
  custoPlaca: number;
  custoPlacaComFalha: number;
  custoUnitario: number;
}

export function calcularCusto(
  produto: Pick<ProdutoInput, "pesoPlacaG" | "tempoPlacaH" | "pecasNaPlaca">,
  params: GlobalParams
): CustoBreakdown {
  const { pesoPlacaG, tempoPlacaH, pecasNaPlaca } = produto;

  const custoFilamento = (pesoPlacaG / 1000) * params.precoFilamentoKg;
  const custoEnergia = tempoPlacaH * params.energiaHora;
  const custoManutencao = tempoPlacaH * params.manutencaoHora;
  const custoPlaca = custoFilamento + custoEnergia + custoManutencao;
  const custoPlacaComFalha = custoPlaca * (1 + params.falhaImpressao);
  const custoUnitario =
    pecasNaPlaca > 0 ? custoPlacaComFalha / pecasNaPlaca : 0;

  return {
    custoFilamento,
    custoEnergia,
    custoManutencao,
    custoPlaca,
    custoPlacaComFalha,
    custoUnitario,
  };
}

export function formatBRL(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return "R$ 0,00";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
