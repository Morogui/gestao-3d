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

// Cores que hoje têm duas opções de material em estoque separado (PLA e
// PETG) — pedido do Guilherme em 2026-07-29: "Nos filamentos, temos que
// adicionar a opcao de Petg na cor preto, branco, vermelho... Os
// filamentos que temos hoje em registro sao todos PLA". Cada combinação
// cor+material vira uma entrada PRÓPRIA em CORES_FILAMENTO (ex: "preto"
// = PLA, "preto-petg" = PETG) — assim TODA a infraestrutura que já era
// genérica por string de cor (estoque_filamento, compras_filamento,
// perdas_filamento_manual, custo médio ponderado, histórico de
// movimentação) passa a suportar PETG sem precisar de uma coluna
// "material" separada em nenhuma dessas tabelas. Os "-petg" nascem
// zerados (sem migração de dado — tudo que já estava registrado
// continua sendo o "preto"/"branco"/"vermelho" comum, ou seja, PLA).
//
// A ÚNICA exceção é na hora de CARREGAR uma placa pra produção:
// corFilamentoDaPlaca() só sabe o nome da placa (ex: "Suporte X
// (Preto)"), nunca qual material está de fato na impressora — por isso
// o operador precisa escolher via uma tag PLA/PETG clicável no momento
// de carregar a máquina (ver CarregarPlacaForm em app/producao/page.tsx
// e a coluna producoes.material), e corPetgDe() abaixo resolve qual
// entrada de estoque descontar de fato quando a produção conclui/falha.
export const CORES_COM_PETG: readonly CorFilamento[] = ["preto", "branco", "vermelho"];

export function corPetgDe(cor: CorFilamento): CorFilamento {
  return `${cor}-petg` as CorFilamento;
}

// Rótulo de exibição — deriva "Preto (PETG)" a partir de "preto-petg"
// sem precisar duplicar entradas nos mapas LABEL_COR_FILAMENTO de cada
// página. Usado nos lugares que hoje só exibem a cor crua (ex: aba
// Financeiro).
export function labelCorFilamento(cor: string): string {
  const petg = cor.endsWith("-petg");
  const base = petg ? cor.slice(0, -"-petg".length) : cor;
  const label = base.charAt(0).toUpperCase() + base.slice(1);
  return petg ? `${label} (PETG)` : label;
}

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
  // Frases alternativas SÓ pra casamento de texto (título de anúncio/SKU
  // real vs. catálogo) — separadas por "|", cada uma tentada em
  // textoCorresponde() (lib/demanda.ts). Adicionada em 2026-07-26 pra
  // resolver um bug real: skuOuKit servia DOIS papéis ao mesmo tempo —
  // texto exibido pro Guilherme na aba Estoque (convenção de 2026-07-23:
  // "aqui sempre temos que ter a sku nao o nome") E o corpo de frases
  // alternativas de casamento. Toda vez que uma frase alternativa era
  // adicionada em skuOuKit, ela poluía a exibição (ex: "SUPORTE UNIVERSAL
  // BRANCO | Suporte De Parede Carregador Carro Eletrico Tipo 2
  // Universal" aparecendo inteiro na aba Estoque). Agora skuOuKit fica
  // limpo (só o texto real exibido) e frasesCorrespondencia guarda as
  // frases extras de anúncio, nunca exibidas em lugar nenhum. Null/vazio
  // quando a placa não precisa de nenhuma frase alternativa.
  frasesCorrespondencia: string | null;
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
  frases_correspondencia?: string | null;
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
  };
}

// Alguns grupos de produto COMPARTILHAM o gancho entre si — pedido do
// Guilherme em 2026-07-26: o gancho do Suporte Universal, do Suporte BMW
// e do Suporte Carregador BYD é a MESMA peça física (mesmo molde/design),
// então uma única placa "Gancho compartilhado" (por cor) abastece os três
// produtos ao mesmo tempo, em vez de cada um ter seu próprio estoque de
// gancho isolado. A placa "Mista" de cada produto (corpo+gancho na MESMA
// impressão) continua sendo só daquele produto — "cada um tem o seu",
// nas palavras do Guilherme — só a placa de gancho AVULSA (impressão só
// de gancho) é que é compartilhada. O Suporte Carro fica de fora dessa
// tabela de propósito: o gancho dele só existe via a própria placa Mista
// do Carro, não usa (nem abastece) o pool compartilhado.
// Os valores à direita são só chaves internas (nunca exibidas) que
// identificam o "pool" de gancho compartilhado de cada cor — ver as
// placas "Gancho Compartilhado (Branco/Preto)" criadas via
// /api/admin/consolidar-gancho-compartilhado.
const GANCHO_COMPARTILHADO_POR_GRUPO: Record<string, string> = {
  Universal: "__gancho_compartilhado_branco__",
  "Universal-Preto": "__gancho_compartilhado_preto__",
  BMW: "__gancho_compartilhado_branco__",
  "BMW-Preto": "__gancho_compartilhado_preto__",
  BYD: "__gancho_compartilhado_branco__",
  "BYD-Preto": "__gancho_compartilhado_preto__",
};

/**
 * Estoque "vendável" de uma placa. Placas diretas: o estoque é o
 * próprio. Placas compostas (corpo+gancho): o vendável é o mínimo entre
 * as duas metades do par — não adianta ter 50 corpos se só há 3
 * ganchos, o produto final trava em 3.
 *
 * Desde 2026-07-26 soma o estoque por PAPEL dentro de cada grupo antes
 * de tirar o mínimo (em vez de tirar o mínimo direto entre todas as
 * placas do grupo) — necessário porque um grupo pode ter mais de uma
 * placa do mesmo papel (ex: Suporte Universal ganhou uma placa Mista
 * além das já existentes Corpos-só e Ganchos-só, e as duas rendem
 * gancho). Grupos listados em GANCHO_COMPARTILHADO_POR_GRUPO também
 * somam o estoque do pool de gancho compartilhado (de outra placa,
 * de outro grupo) ao seu próprio gancho antes de comparar com o corpo.
 * Com uma única placa por papel e sem compartilhamento (caso mais
 * comum, ex: Suporte Carro), o resultado é idêntico ao de antes.
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
      const ganchoProprio = porPapel.get("gancho") ?? 0; // ex: saída da placa Mista
      const ganchoDoPool = gruposPorPapel.get(poolCompartilhado)?.get("gancho") ?? 0;
      resultado.set(grupo, Math.min(corpo, ganchoProprio + ganchoDoPool));
    } else {
      const min = Math.min(...porPapel.values());
      resultado.set(grupo, min);
    }
  }

  return resultado;
}
