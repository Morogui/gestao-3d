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
