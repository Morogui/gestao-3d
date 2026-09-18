// Lógica de cálculo de custo de impressão 3D
// Fórmula (conforme definido pelo usuário):
//
// Custo Filamento = (peso da placa em g ÷ 1000) × preço do filamento (R$/kg)
// Custo Energia = tempo da placa (h) × energia (R$/h)
// Custo Manutenção = tempo da placa (h) × manutenção (R$/h)
// Custo da Placa = Custo Filamento + Custo Energia + Custo Manutenção
// Custo da Placa c/ Falha = Custo da Placa × (1 + falha de impressão)
// Custo unitário (por peça) = Custo da Placa c/ Falha ÷ peças na placa
//
// Esta calculadora cobra o custo da peça solta. A montagem de kits/SKUs
// (várias peças formando um produto vendido) é resolvida depois, na aba
// de Vendas/Produção, multiplicando o custo unitário de cada peça pela
// composição do kit.
//
// Extensão de 2026-09-18 — pedido do Guilherme: produtos que rodam na
// A2L (mesa menor, layout diferente) não têm só peças/placa diferentes
// da A1 — peso e tempo da placa também mudam de verdade (ex: "Suporte
// Papel Toalha", placa Base: A1 = 4un/3h57, A2L = 8un/7h52/184g). Por
// isso agora existe um segundo conjunto completo de campos "A2L" (peso,
// tempo, peças), tanto na placa principal quanto em cada placa
// adicional de um produto composto. Além disso, produtos como "Suporte
// Carro" e "Suporte Papel Toalha" são montados com MAIS de uma placa
// (cada uma produzindo uma peça diferente do conjunto final, em
// quantidades diferentes) — placasAdicionais guarda essas placas extras
// e é usado só na criação/edição pela aba Custo; a montagem real
// (SKU -> placas) continua vivendo no catálogo de produção (placas +
// sku_placa), pra funcionar sem mudanças em Produção/Full/Estoque.

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

// Uma placa componente "extra" de um produto composto (ex: a placa
// "Lateral" do Suporte Papel Toalha, além da placa principal "Base").
// placaId só existe depois de salva no catálogo de produção — o
// formulário cria linhas sem placaId, o backend cria a placa e devolve
// o id pra edições futuras conseguirem atualizar a mesma placa em vez
// de duplicar.
export interface PlacaComponenteInput {
  placaId?: number | null;
  /** nome do que essa placa produz, ex: "Base", "Lateral", "Gancho" */
  nome: string;
  pesoPlacaG: number;
  tempoPlacaH: number;
  pesoPlacaA2lG?: number | null;
  tempoPlacaA2lH?: number | null;
  pecasNaPlaca: number;
  pecasNaPlacaA2l?: number | null;
  /** quantas peças desta placa entram em 1 unidade do produto final (padrão 1) */
  pecasPorUnidade?: number | null;
}

export interface ProdutoInput {
  id: string;
  /** nome ou código do produto — serve como identificador para busca/filtro */
  nome: string;
  /** SKU do produto (opcional). Pode conter mais de um SKU separado por
   * vírgula ou quebra de linha, quando a mesma placa (ou conjunto de
   * placas) atende variações de cor diferentes — ex: "SUPORTE PAPEL
   * TOALHA VERDE, SUPORTE PAPEL TOALHA VERDE E DOURADO". */
  sku: string;
  /** nome específico da placa principal (opcional) — se vazio, usa
   * `nome` do produto. Útil quando o produto já é composto e a placa
   * principal também merece um rótulo próprio (ex: "Base"). */
  nomePlaca?: string | null;
  /** peso da placa inteira, em gramas */
  pesoPlacaG: number;
  /** tempo de impressão da placa, em horas */
  tempoPlacaH: number;
  /** quantas peças saem em uma placa */
  pecasNaPlaca: number;
  /** id da placa de produção vinculada (null/undefined = ainda não vinculado) */
  placaId?: number | null;
  /** quantas peças saem em uma placa quando impressa na impressora A2L —
   * ela cabe uma quantidade diferente das demais impressoras (mesa
   * menor). null/undefined/0 = ainda não informado (esse produto nunca
   * roda na A2L, ou o valor é o mesmo de pecasNaPlaca) — nesse caso o
   * custo unitário na A2L não é exibido em lugar nenhum. Pedido do
   * Guilherme em 2026-08-31. */
  pecasNaPlacaA2l?: number | null;
  /** peso da placa na A2L, se diferente do peso na A1 (pesoPlacaG).
   * null/undefined = usa o mesmo peso da A1. */
  pesoPlacaA2lG?: number | null;
  /** tempo de impressão da placa na A2L, se diferente do tempo na A1
   * (tempoPlacaH). null/undefined = usa o mesmo tempo da A1. */
  tempoPlacaA2lH?: number | null;
  /** quantas peças desta placa (principal) entram em 1 unidade do
   * produto final — normalmente 1. Só importa quando o produto é
   * composto por mais de uma placa em proporções diferentes. */
  pecasPorUnidade?: number | null;
  /** placas extras que, junto com a placa principal, formam o produto
   * composto (ex: Suporte Carro = corpo + gancho; Suporte Papel Toalha
   * = base + lateral). Vazio/ausente = produto de placa única (padrão,
   * cobre todos os produtos cadastrados até hoje). */
  placasAdicionais?: PlacaComponenteInput[];
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

// Divide um campo de SKU(s) em uma lista limpa — aceita vírgula ou
// quebra de linha como separador, e ignora espaços/entradas vazias.
// Usado tanto no formulário (pra saber quantos SKUs vincular às placas)
// quanto nas rotas de API (pra reconstruir a lista a partir do texto
// salvo em produtos.sku).
export function parseSkus(sku: string | null | undefined): string[] {
  if (!sku) return [];
  return sku
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function formatBRL(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return "R$ 0,00";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
