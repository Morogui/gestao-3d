// Tipos compartilhados entre as rotas de API e a página de Produção pro
// catálogo de placas (ver docs/logica-producao-placas.md).

export interface PlacaRow {
  id: number;
  numero: number;
  nome: string;
  tipo: "direta" | "composto";
  papel: "corpo" | "gancho" | null;
  grupoComposto: string | null;
  skuOuKit: string;
  pecasPorPlaca: number;
  tempoPlacaHoras: number;
  tier: "A" | "B" | "C";
  descontinuada: boolean;
  estoque: number;
  // Peso de filamento gasto por placa impressa, em gramas — usado pra
  // calcular quanto já foi impresso (aba Produção). Null enquanto o
  // Guilherme não confirma o valor real (mesmo padrão de "dado ainda não
  // confirmado" já usado pra tempo/placa e peças/placa nas 14 placas
  // novas do catálogo).
  pesoPlacaGramas: number | null;
}

export interface DbPlacaRow {
  id: number;
  numero: number;
  nome: string;
  tipo: string;
  papel: string | null;
  grupo_composto: string | null;
  sku_ou_kit: string;
  pecas_por_placa: string;
  tempo_placa_horas: string;
  tier: string;
  descontinuada: boolean;
  estoque: string;
  peso_placa_gramas: string | null;
}

export function toPlacaRow(row: DbPlacaRow): PlacaRow {
  return {
    id: row.id,
    numero: row.numero,
    nome: row.nome,
    tipo: row.tipo as PlacaRow["tipo"],
    papel: row.papel as PlacaRow["papel"],
    grupoComposto: row.grupo_composto,
    skuOuKit: row.sku_ou_kit,
    pecasPorPlaca: Number(row.pecas_por_placa),
    tempoPlacaHoras: Number(row.tempo_placa_horas),
    tier: row.tier as PlacaRow["tier"],
    descontinuada: row.descontinuada,
    estoque: Number(row.estoque),
    pesoPlacaGramas:
      row.peso_placa_gramas === null || row.peso_placa_gramas === undefined
        ? null
        : Number(row.peso_placa_gramas),
  };
}

/**
 * Estoque "vendável" de uma placa. Placas diretas: o estoque é o
 * próprio. Placas compostas (corpo+gancho): o vendável é o mínimo entre
 * as duas metades do par — não adianta ter 50 corpos se só há 3
 * ganchos, o produto final trava em 3.
 */
export function estoqueVendavel(placas: PlacaRow[]): Map<string, number> {
  const resultado = new Map<string, number>();
  const grupos = new Map<string, PlacaRow[]>();

  for (const placa of placas) {
    if (placa.tipo !== "composto" || !placa.grupoComposto) continue;
    const lista = grupos.get(placa.grupoComposto) ?? [];
    lista.push(placa);
    grupos.set(placa.grupoComposto, lista);
  }

  for (const [grupo, lista] of grupos) {
    const min = Math.min(...lista.map((p) => p.estoque));
    resultado.set(grupo, min);
  }

  return resultado;
}
