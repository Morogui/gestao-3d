// Tipos compartilhados pela página de Produção (client component) —
// espelham o formato JSON devolvido pelas rotas de API.

import { CorFilamento } from "./placas";

// Estoque de filamento por cor, em gramas — ver
// app/api/producao/filamento/route.ts. Cor deixada em 0 bloqueia
// automaticamente a fila de prioridade pras placas daquela cor (ver
// corFilamentoDaPlaca em lib/placas.ts).
export type EstoqueFilamentoRow = Record<CorFilamento, number>;

// Conversão gramas <-> Kg pra exibição — pedido do Guilherme em
// 2026-07-29: "No painel tem que mostrar em kg e gramas" (o estoque
// guarda gramas no banco, mas em telão de número grande tipo "60000" é
// difícil de ler; o operador pensa em Kg). Usa vírgula (padrão BR) e no
// máximo 2 casas decimais, sem zero à direita forçado — ex: 60000g ->
// "60", 5050g -> "5,05", 20030g -> "20,03".
export function formatGramasEmKg(gramas: number): string {
  return (gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

// Inverso — converte o texto que o usuário digitou (em Kg, com vírgula
// ou ponto) de volta pra gramas, pra gravar no banco do jeito que já
// era feito antes. Arredonda pro grama mais próximo.
export function parseKgParaGramas(texto: string): number {
  const kg = Number(texto.replace(",", ".")) || 0;
  return Math.round(kg * 1000);
}

export interface MachineRow {
  id: number;
  nome: string;
  ativa: boolean;
}

export interface ProducaoRow {
  id: number;
  machine_id: number;
  placa_id: number;
  quantidade_placas: string;
  status: "em_andamento" | "concluida" | "cancelada" | "falha_placa";
  iniciado_em: string;
  concluido_em: string | null;
  machine_nome: string;
  placa_nome: string;
  pecas_por_placa: string;
  gramas_desperdicadas: string | null;
  falhas_peca_count: string;
  // Material escolhido pelo operador ao carregar a máquina — só existe
  // pra cores com opção PETG (preto/branco/vermelho); null = PLA (padrão
  // e único material das demais cores). Ver CORES_COM_PETG/corPetgDe em
  // lib/placas.ts.
  material: "PLA" | "PETG" | null;
}

export interface FalhaPecaRow {
  id: number;
  producao_id: number;
  peca_descricao: string;
  gramas: string;
  criado_em: string;
}

export interface DemandaPlacaRow {
  placaId: number;
  qtyVendidaPeriodo: number;
  qtyVendidaFull: number;
  mediaSemanal: number;
  recomendadoEstoque: number;
  aProduzir: number;
  // Data (ISO) do pedido mais recente que bateu com essa placa nos últimos
  // 30 dias — null se não vendeu nada no período. Usado na fila de
  // prioridade pra saber se o produto vendeu nas últimas 2 semanas (ver
  // lib/demanda.ts).
  ultimaVendaEm: string | null;
  // Peças de pedidos pagos e ainda não despachados — backlog real de
  // despacho, mais urgente que a meta média de "dias de estoque" (ver
  // lib/demanda.ts e critério nº-1 em app/producao/page.tsx).
  pecasPendentesDespacho: number;
}

export interface NaoIdentificadoRow {
  qtyPeriodo: number;
  qtyFull: number;
  // itemId = MLBxxxx (ML) ou item_id (Shopee) — pra localizar o anúncio
  // exato na plataforma quando o título sozinho é ambíguo (pedido do
  // Guilherme em 2026-07-28).
  amostras: {
    titulo: string;
    sku: string;
    quantity: number;
    isFull: boolean;
    itemId: string;
  }[];
}

export interface DemandaResult {
  connected: boolean;
  error?: boolean;
  periodo?: { inicio: string; fim: string };
  totalPedidos?: number;
  // false quando a Shopee não está conectada (ou sessão expirada) — nesse
  // caso a demanda calculada é só com base na ML, então "a produzir" pode
  // estar subestimado pra SKUs que também vendem na Shopee.
  shopeeConectada?: boolean;
  demanda?: DemandaPlacaRow[];
  naoIdentificado?: NaoIdentificadoRow;
  naoIdentificadoSemana?: NaoIdentificadoRow;
}

// Consumo de filamento acumulado (desde sempre) — ver
// app/api/producao/consumo/route.ts pra detalhes de como é calculado.
export interface ConsumoResult {
  gramasImpressas: number;
  gramasImpressasCalculadas: number;
  gramasImpressasManual: number;
  gramasDesperdicadas: number;
  gramasDesperdicadasPlaca: number;
  gramasDesperdicadasPeca: number;
  gramasDesperdicadasManual: number;
  placasSemPeso: number;
  totalPlacas: number;
  // Taxa de falha real: peças com falha (falha de peça avulsa + placas
  // inteiras perdidas em falha_placa) sobre o total de peças já rodadas
  // (produções concluídas ou com falha_placa — não conta em_andamento nem
  // cancelada, já que essas não chegaram a ser realmente impressas até o
  // fim). Ver app/api/producao/consumo/route.ts pra detalhes do cálculo.
  pecasRodadas: number;
  pecasComFalha: number;
  percentualFalha: number;
}
