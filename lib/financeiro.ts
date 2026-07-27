// Aba Financeiro — pedido do Guilherme em 2026-07-27: "controle
// financeiro da empresa, os gastos da empresa, um calendario com datas
// de pagamento, um lugar onde consiga subir o arquivo do pagamento ou
// recebimento e apos subir esse arquivo, integrar uma IA pra ler o
// documento e listar como despesa... fora isso compramos filamentos em
// diversas datas e precisamos fazer o custo medio do meu filamento".
//
// Categorias fixas só pra padronizar o filtro/relatório — o campo em si
// é texto livre (o usuário pode digitar outra categoria manualmente ou
// a IA pode sugerir uma fora dessa lista).
export const CATEGORIAS_DESPESA = [
  "Filamento",
  "Energia elétrica",
  "Embalagem",
  "Frete",
  "Marketing/Ads",
  "Taxas de marketplace",
  "Impostos",
  "Manutenção de equipamento",
  "Software/Assinaturas",
  "Aluguel",
  "Internet/Telefone",
  "Salário/Pró-labore",
  "Outros",
] as const;

export const CATEGORIAS_RECEITA = [
  "Venda direta",
  "Reembolso",
  "Outro recebimento",
  "Outros",
] as const;

export type TipoLancamento = "despesa" | "receita";
export type StatusLancamento = "pendente" | "pago";

export interface LancamentoFinanceiro {
  id: number;
  tipo: TipoLancamento;
  categoria: string;
  descricao: string;
  valor: number;
  dataVencimento: string;
  dataPagamento: string | null;
  status: StatusLancamento;
  fornecedor: string | null;
  arquivoNome: string | null;
  arquivoMime: string | null;
  criadoEm: string;
}

export interface CompraFilamento {
  id: number;
  cor: string;
  gramas: number;
  valorPago: number;
  dataCompra: string;
  fornecedor: string | null;
  criadoEm: string;
}
