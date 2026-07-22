// Tipos compartilhados pela página de Produção (client component) —
// espelham o formato JSON devolvido pelas rotas de API.

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
}

export interface NaoIdentificadoRow {
  qtyPeriodo: number;
  qtyFull: number;
  amostras: { titulo: string; sku: string; quantity: number; isFull: boolean }[];
}

export interface DemandaResult {
  connected: boolean;
  error?: boolean;
  periodo?: { inicio: string; fim: string };
  totalPedidos?: number;
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
  placasSemPeso: number;
  totalPlacas: number;
}
