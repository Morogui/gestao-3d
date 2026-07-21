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
  status: "em_andamento" | "concluida" | "cancelada";
  iniciado_em: string;
  concluido_em: string | null;
  machine_nome: string;
  placa_nome: string;
  pecas_por_placa: string;
}

export interface DemandaPlacaRow {
  placaId: number;
  qtyVendidaSemana: number;
  qtyVendidaFull: number;
  recomendadoSemanal: number;
  aProduzir: number;
}

export interface DemandaResult {
  connected: boolean;
  error?: boolean;
  periodo?: { inicio: string; fim: string };
  totalPedidos?: number;
  demanda?: DemandaPlacaRow[];
}
