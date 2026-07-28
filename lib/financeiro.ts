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

// Forma de pagamento — pedido do Guilherme em 2026-07-27: "a IA separar
// essa compra por categoria e qual tipo de pagamento". Lista só de
// sugestão (o campo aceita texto livre via datalist), cobrindo os meios
// mais comuns em comprovante de boleto/nota/PIX.
export const FORMAS_PAGAMENTO = [
  "PIX",
  "Boleto",
  "Cartão de crédito",
  "Cartão de débito",
  "Transferência (TED/DOC)",
  "Dinheiro",
  "Outro",
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
  formaPagamento: string | null;
  arquivoNome: string | null;
  arquivoMime: string | null;
  criadoEm: string;
}

// Compra a vista ou a prazo — pedido do Guilherme em 2026-07-27:
// "Filamento pode ser a vista, com prazo para pagamwento entao tem que
// conseguir coloca o prazo". dataVencimento é quando o pagamento vence
// (= dataCompra se for à vista); status/dataPagamento seguem o mesmo
// padrão de LancamentoFinanceiro pra poder marcar como pago depois.
export interface CompraFilamento {
  id: number;
  cor: string;
  gramas: number;
  valorPago: number;
  dataCompra: string;
  dataVencimento: string;
  status: StatusLancamento;
  dataPagamento: string | null;
  fornecedor: string | null;
  criadoEm: string;
}
