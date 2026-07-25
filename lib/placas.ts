// Tipos compartilhados entre as rotas de API e a página de Produção pro
// catálogo de placas (ver docs/logica-producao-placas.md).

// Cores de filamento controladas em estoque — pedido do Guilherme em
// 2026-07-25: "adicione um campo onde coloco o que tenho de filamento...
// o que eu deixar zerado nao precisa subir produto para a producao". A
// fila de prioridade (app/producao/page.tsx) exclui automaticamente
// qualquer placa cuja cor de filamento esteja zerada — ver
// corFilamentoDaPlaca() abaixo.
export const CORES_FILAMENTO = [
  "colorido",
  "preto",
  "branco",
  "prata",
  "marrom",
  "bege",
] as const;
export type CorFilamento = (typeof CORES_FILAMENTO)[number];

function normalizeCor(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Descobre a cor de filamento de uma placa a partir do nome — reaproveita
// a mesma convenção "Nome (Cor)" já usada no catálogo inteiro (ver
// corDoTexto em lib/demanda.ts). Duas cores existem no catálogo mas não
// têm campo de estoque próprio (cinza, laranja) — retorna null nesse
// caso, o que significa "sem restrição" (nunca é bloqueada por
// filamento zerado, já que não temos como saber a quantidade real).
// Placas SEM cor no nome (ex: "6X3 21 FATIAS", kits diversos) assumem
// "colorido" — são justamente os produtos multicoloridos/de
// confeitaria que usam filamento arco-íris, que nunca aparecem com uma
// cor sólida no nome.
const CORES_CONHECIDAS_NO_NOME = [
  "branco",
  "preto",
  "preta",
  "cinza",
  "marrom",
  "prata",
  "bege",
  "laranja",
];
export function corFilamentoDaPlaca(nome: string): CorFilamento | null {
  const tokens = new Set(normalizeCor(nome).split(" "));
  for (const cor of CORES_CONHECIDAS_NO_NOME) {
    if (tokens.has(cor)) {
      const mapeada = cor === "preta" ? "preto" : cor;
      return (CORES_FILAMENTO as readonly string[]).includes(mapeada)
        ? (mapeada as CorFilamento)
        : null;
    }
  }
  return "colorido";
}

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
  // Placa "mista": além das pecasPorPlaca do seu próprio papel, cada
  // impressão TAMBÉM rende saidaExtraPecas unidades de uma placa
  // DIFERENTE (saidaExtraPlacaId) na mesma mesa. Caso real (2026-07-24):
  // "Suporte Carro - Mista" é uma placa de gancho que sai 3
  // ganchos + 2 corpos por impressão — o corpo extra tem que creditar no
  // estoque da placa "Suporte Carro - Corpos" quando a produção conclui.
  // Null pras placas normais (a grande maioria).
  saidaExtraPlacaId: number | null;
  saidaExtraPecas: number | null;
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
  saida_extra_placa_id?: number | null;
  saida_extra_pecas?: number | string | null;
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
    saidaExtraPlacaId: row.saida_extra_placa_id ?? null,
    saidaExtraPecas:
      row.saida_extra_pecas === null || row.saida_extra_pecas === undefined
        ? null
        : Number(row.saida_extra_pecas),
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
