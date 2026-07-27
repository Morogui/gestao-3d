import { sql } from "@/lib/db";

// Aprendizado de categorias — pedido do Guilherme em 2026-07-27: "Conforme
// eu prencher a descricao, a IA deve separar a categoria para essa
// descricao, e sempre ir aprendendo com os fornecedores, descricao e ir
// organizando de forma mais clara." Em vez de forçar tudo dentro da lista
// fixa de categorias (que não cobre categorias que o Guilherme já vem
// usando na prática, tipo "Impressora", "Investimento", "Venda"), essas
// funções server-only buscam o que já foi realmente usado no histórico
// (por tipo e por fornecedor) e devolvem pra IA escolher entre a lista
// fixa + o que já existe — assim o sistema vai reaproveitando as
// categorias que o próprio uso já consolidou, em vez de criar variações
// quase iguais ou jogar tudo em "Outros". Import só em route handlers
// (server) — nunca em lib/financeiro.ts, que é importado pelo client.

export async function categoriasHistoricas(tipo: "despesa" | "receita"): Promise<string[]> {
  try {
    const rows = (await sql`
      SELECT categoria, COUNT(*) as freq
      FROM financeiro_lancamentos
      WHERE tipo = ${tipo}
      GROUP BY categoria
      ORDER BY freq DESC
      LIMIT 40
    `) as { categoria: string; freq: string }[];
    return rows.map((r) => r.categoria).filter((c) => !!c && c.trim().length > 0);
  } catch {
    return [];
  }
}

export interface HistoricoFornecedorItem {
  descricao: string;
  categoria: string;
}

// Últimos lançamentos do mesmo fornecedor (ILIKE parcial — cobre pequenas
// variações de digitação/formatação do nome) — servem de exemplo pra IA
// reaproveitar a categoria que o Guilherme já usou pra esse fornecedor em
// vez de reclassificar do zero toda vez.
export async function historicoFornecedor(
  tipo: "despesa" | "receita",
  fornecedor: string
): Promise<HistoricoFornecedorItem[]> {
  const termo = fornecedor.trim();
  if (!termo) return [];
  try {
    const rows = (await sql`
      SELECT descricao, categoria
      FROM financeiro_lancamentos
      WHERE tipo = ${tipo} AND fornecedor ILIKE ${"%" + termo + "%"}
      ORDER BY criado_em DESC
      LIMIT 5
    `) as HistoricoFornecedorItem[];
    return rows;
  } catch {
    return [];
  }
}

// Uniao das categorias fixas + as que já foram usadas no histórico
// (dedupe case-insensitive, preservando a primeira grafia encontrada).
export function mesclarCategorias(fixas: readonly string[], historicas: string[]): string[] {
  const vistas = new Set(fixas.map((c) => c.toLowerCase()));
  const extras = historicas.filter((c) => {
    const chave = c.toLowerCase();
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
  return [...fixas, ...extras];
}
