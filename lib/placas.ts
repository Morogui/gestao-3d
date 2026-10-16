// Tipos compartilhados entre as rotas de API e a página de Produção pro
// catálogo de placas (ver docs/logica-producao-placas.md).

// Cores de filamento controladas em estoque. Cada combinação cor+material
// é uma entrada própria (ex: "preto" = PLA, "preto-petg" = PETG).
// CORES_FILAMENTO/CorFilamento = lista ANTIGA (usada pela página de
// Produção, que tem Record<CorFilamento,...>). CORES_FILAMENTO_TODAS =
// lista completa com PLA e PETG pra TODAS as cores (pedido do Guilherme em
// 2026-10-15: "todos tem PLA e PETG") — usada no estoque e nas APIs.
export const CORES_FILAMENTO = [
  "colorido",
  "preto",
  "preto-petg",
  "branco",
  "branco-petg",
  "prata",
  "marrom",
  "bege",
  "vermelho",
  "vermelho-petg",
] as const;
export type CorFilamento = (typeof CORES_FILAMENTO)[number];

export const CORES_FILAMENTO_TODAS = [
  "colorido",
  "preto",
  "preto-petg",
  "branco",
  "branco-petg",
  "prata",
  "prata-petg",
  "marrom",
  "marrom-petg",
  "bege",
  "bege-petg",
  "cinza",
  "cinza-petg",
  "vermelho",
  "vermelho-petg",
] as const;
export type CorFilamentoTodas = (typeof CORES_FILAMENTO_TODAS)[number];

// Cores com duas opções de material (PLA e PETG) em estoque separado. O
// operador escolhe PLA/PETG ao carregar a máquina (producoes.material) e
// corPetgDe() resolve qual entrada de estoque descontar.
export const CORES_COM_PETG: readonly CorFilamento[] = [
  "preto",
  "branco",
  "vermelho",
  "prata",
  "marrom",
  "bege",
];

export function corPetgDe(cor: CorFilamento): CorFilamento {
  return `${cor}-petg` as CorFilamento;
}

// Rótulo de exibição: "preto" -> "Preto (PLA)", "preto-petg" -> "Preto
// (PETG)", "colorido" -> "Colorido".
export function labelCorFilamento(cor: string): string {
  const petg = cor.endsWith("-petg");
  const base = petg ? cor.slice(0, -"-petg".length) : cor;
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  if (petg) return `${label} (PETG)`;
  if ((CORES_COM_PETG as readonly string[]).includes(base) || base === "cinza") return `${label} (PLA)`;
  return label;
}

function normalizeCor(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Descobre a cor de filamento de uma placa a partir do nome ("Nome (Cor)").
// Cinza/laranja não têm estoque próprio -> null (sem restrição). Placas sem
// cor no nome assumem "colorido".
const CORES_CONHECIDAS_NO_NOME = [
  "branco",
  "preto",
  "preta",
  "cinza",
  "marrom",
  "prata",
  "bege",
  "laranja",
  "vermelho",
  "vermelha",
];
export function corFilamentoDaPlaca(nome: string): CorFilamento | null {
  const tokens = new Set(normalizeCor(nome).split(" "));
  for (const cor of CORES_CONHECIDAS_NO_NOME) {
    if (tokens.has(cor)) {
      const mapeada = cor === "preta" ? "preto" : cor === "vermelha" ? "vermelho" : cor;
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
  // Frases alternativas SÓ pra casamento de texto (separadas por "|"),
  // nunca exibidas.
  frasesCorrespondencia: string | null;
  pecasPorPlaca: number;
  tempoPlacaHoras: number;
  tier: "A" | "B" | "C";
  descontinuada: boolean;
  estoque: number;
  // Peso de filamento por placa (g); null enquanto não confirmado.
  pesoPlacaGramas: number | null;
  // Placa "mista": cada impressão TAMBÉM rende saidaExtraPecas unidades de
  // outra placa (saidaExtraPlacaId).
  saidaExtraPlacaId: number | null;
  saidaExtraPecas: number | null;
  dadosConfirmados: boolean;
  dadosConfirmadosA2l: boolean;
  pecasPorPlacaA2l: number | null;
  tempoPlacaHorasA2l: number | null;
  pesoPlacaGramasA2l: number | null;
}

export interface DbPlacaRow {
  id: number;
  numero: number;
  nome: string;
  tipo: string;
  papel: string | null;
  grupo_composto: string | null;
  sku_ou_kit: string;
  frases_correspondencia?: string | null;
  pecas_por_placa: string;
  tempo_placa_horas: string;
  tier: string;
  descontinuada: boolean;
  estoque: string;
  peso_placa_gramas: string | null;
  saida_extra_placa_id?: number | null;
  saida_extra_pecas?: number | string | null;
  dados_confirmados: boolean;
  dados_confirmados_a2l: boolean;
  pecas_por_placa_a2l: string | null;
  tempo_placa_horas_a2l: string | null;
  peso_placa_gramas_a2l: string | null;
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
    frasesCorrespondencia: row.frases_correspondencia ?? null,
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
    dadosConfirmados: row.dados_confirmados,
    dadosConfirmadosA2l: row.dados_confirmados_a2l,
    pecasPorPlacaA2l: row.pecas_por_placa_a2l === null || row.pecas_por_placa_a2l === undefined ? null : Number(row.pecas_por_placa_a2l),
    tempoPlacaHorasA2l: row.tempo_placa_horas_a2l === null || row.tempo_placa_horas_a2l === undefined ? null : Number(row.tempo_placa_horas_a2l),
    pesoPlacaGramasA2l: row.peso_placa_gramas_a2l === null || row.peso_placa_gramas_a2l === undefined ? null : Number(row.peso_placa_gramas_a2l),
  };
}

// Grupos que COMPARTILHAM o gancho entre si (Universal, BMW, BYD): a
// placa "Gancho compartilhado" (por cor) abastece os três. Valores são
// chaves internas dos pools. O Suporte Carro fica de fora.
const GANCHO_COMPARTILHADO_POR_GRUPO: Record<string, string> = {
  Universal: "__gancho_compartilhado_branco__",
  "Universal-Preto": "__gancho_compartilhado_preto__",
  BMW: "__gancho_compartilhado_branco__",
  "BMW-Preto": "__gancho_compartilhado_preto__",
  BYD: "__gancho_compartilhado_branco__",
  "BYD-Preto": "__gancho_compartilhado_preto__",
};

/**
 * Estoque "vendável" de uma placa. Diretas: o próprio estoque. Compostas
 * (corpo+gancho): mínimo entre as metades do par, somando o estoque por
 * PAPEL dentro de cada grupo (e o pool de gancho compartilhado quando o
 * grupo está em GANCHO_COMPARTILHADO_POR_GRUPO).
 */
export function estoqueVendavel(placas: PlacaRow[]): Map<string, number> {
  const resultado = new Map<string, number>();
  const gruposPorPapel = new Map<string, Map<string, number>>();

  for (const placa of placas) {
    if (placa.tipo !== "composto" || !placa.grupoComposto || !placa.papel)
      continue;
    const porPapel =
      gruposPorPapel.get(placa.grupoComposto) ?? new Map<string, number>();
    porPapel.set(placa.papel, (porPapel.get(placa.papel) ?? 0) + placa.estoque);
    gruposPorPapel.set(placa.grupoComposto, porPapel);
  }

  for (const [grupo, porPapel] of gruposPorPapel) {
    const poolCompartilhado = GANCHO_COMPARTILHADO_POR_GRUPO[grupo];
    if (poolCompartilhado) {
      const corpo = porPapel.get("corpo") ?? 0;
      const ganchoProprio = porPapel.get("gancho") ?? 0;
      const ganchoDoPool = gruposPorPapel.get(poolCompartilhado)?.get("gancho") ?? 0;
      resultado.set(grupo, Math.min(corpo, ganchoProprio + ganchoDoPool));
    } else {
      const min = Math.min(...porPapel.values());
      resultado.set(grupo, min);
    }
  }

  return resultado;
}
