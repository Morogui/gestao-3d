import { sql } from "@/lib/db";

// Categoria (Tier) movida da aba Full pra Análise — pedido do Guilherme
// em 2026-09-17: "nao faz sentido [mostrar Tier e estoque no card Full
// sem vendas]... a categoria, pode colocar na parte de analise, uma
// categoria, Tier Full Mercado livre - mostra os produtos do mercado
// livre e Tier Mercado Livre Geral e Shopee Geral". Duas visões do
// mesmo campo `placas.tier`:
// - fullMercadoLivre: só as placas que já têm alguma linha de estoque
//   no Full (estoque_full_placas) — ou seja, produtos que realmente
//   circulam pelo Full, não o catálogo inteiro.
// - geralMlShopee: catálogo inteiro (todas as placas ativas), já que o
//   Tier em si é calculado a partir da demanda combinada ML+Shopee (ver
//   lib/demanda.ts) — é o Tier "geral" do negócio, não só do Full.
export interface ItemCategoriaTier {
  id: number;
  numero: number;
  nome: string;
  tier: "A" | "B" | "C" | string;
}

export interface CategoriaTierResultado {
  fullMercadoLivre: ItemCategoriaTier[];
  geralMlShopee: ItemCategoriaTier[];
}

export async function getCategoriaTier(): Promise<CategoriaTierResultado> {
  const geralRows = (await sql`
    SELECT id, numero, nome, tier
    FROM placas
    WHERE descontinuada = false
    ORDER BY tier ASC, numero ASC
  `) as { id: number; numero: number; nome: string; tier: string }[];

  const fullRows = (await sql`
    SELECT DISTINCT p.id, p.numero, p.nome, p.tier
    FROM placas p
    INNER JOIN estoque_full_placas ef ON ef.placa_id = p.id
    WHERE p.descontinuada = false
    ORDER BY p.tier ASC, p.numero ASC
  `) as { id: number; numero: number; nome: string; tier: string }[];

  return {
    geralMlShopee: geralRows.map((r) => ({
      id: r.id,
      numero: r.numero,
      nome: r.nome,
      tier: r.tier,
    })),
    fullMercadoLivre: fullRows.map((r) => ({
      id: r.id,
      numero: r.numero,
      nome: r.nome,
      tier: r.tier,
    })),
  };
}
