import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Aba "Produtos" — pedido do Guilherme em 2026-08-26: uma aba onde fica
// cadastrado todo produto e como ele é composto (quais placas, com que
// papel — corpo/gancho — e quantas peças por unidade vendida), com
// todas as SKUs já registradas no sistema. Não é uma tabela nova: os
// dados já existem em "placas" (catálogo real de produção) e
// "sku_placa" (SKU real da venda -> placa + peças por unidade), só
// nunca tinham uma tela própria juntando os dois na visão "por SKU".
//
// Uma mesma SKU pode aparecer com mais de um componente quando é um
// kit (ex: corpo impresso numa placa + gancho impresso em outra),
// então agrupamos as linhas de sku_placa por sku antes de responder.

interface SkuPlacaRow {
  sku: string;
  placa_id: number;
  pecas_por_unidade: string;
  placa_nome: string;
  placa_numero: number;
  papel: string | null;
  grupo_composto: string | null;
  tier: string;
  tipo: string;
  peso_placa_gramas: string | null;
  tempo_placa_horas: string;
  descontinuada: boolean;
  estoque: string;
  sku_principal: string | null;
}

interface Componente {
  placaId: number;
  placaNumero: number;
  placaNome: string;
  papel: string | null;
  grupoComposto: string | null;
  pecasPorUnidade: number;
  tier: string;
  tipo: string;
  pesoPlacaGramas: number | null;
  tempoPlacaHoras: number;
  descontinuada: boolean;
  estoque: number;
  skuPrincipal: string | null;
}

interface ProdutoRow {
  sku: string;
  componentes: Componente[];
}

interface PlacaSemSkuRow {
  id: number;
  numero: number;
  nome: string;
  papel: string | null;
  grupo_composto: string | null;
  tier: string;
}

export async function GET() {
  const rows = (await sql`
    SELECT
      sp.sku, sp.placa_id, sp.pecas_por_unidade,
      pl.nome AS placa_nome, pl.numero AS placa_numero, pl.papel, pl.grupo_composto,
      pl.tier, pl.tipo, pl.peso_placa_gramas, pl.tempo_placa_horas, pl.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque,
    (
      SELECT sp2.sku
      FROM sku_placa sp2
      WHERE sp2.placa_id = sp.placa_id
        AND sp2.pecas_por_unidade = 1
        AND sp2.sku <> sp.sku
        AND (SELECT COUNT(*) FROM sku_placa sp3 WHERE sp3.sku = sp2.sku) = 1
      ORDER BY sp2.sku ASC
      LIMIT 1
    ) AS sku_principal
    FROM sku_placa sp
    JOIN placas pl ON pl.id = sp.placa_id
    LEFT JOIN estoque_placas e ON e.placa_id = pl.id
    ORDER BY sp.sku ASC, pl.numero ASC
  `) as SkuPlacaRow[];

  const porSku = new Map<string, ProdutoRow>();
  for (const r of rows) {
    const item = porSku.get(r.sku) ?? { sku: r.sku, componentes: [] };
    item.componentes.push({
      placaId: r.placa_id,
      placaNumero: r.placa_numero,
      placaNome: r.placa_nome,
      papel: r.papel,
      grupoComposto: r.grupo_composto,
      pecasPorUnidade: Number(r.pecas_por_unidade),
      tier: r.tier,
      tipo: r.tipo,
      pesoPlacaGramas:
        r.peso_placa_gramas === null ? null : Number(r.peso_placa_gramas),
      tempoPlacaHoras: Number(r.tempo_placa_horas),
      descontinuada: r.descontinuada,
      estoque: Number(r.estoque),
      skuPrincipal: r.sku_principal ?? null,
    });
    porSku.set(r.sku, item);
  }

  const produtos = Array.from(porSku.values()).sort((a, b) =>
    a.sku.localeCompare(b.sku)
  );

  // Placas ativas que ainda não têm nenhuma SKU real apontando pra elas —
  // um gap de catálogo que vale sinalizar (produto pronto pra produção
  // mas que nenhuma venda vai conseguir descontar do estoque ainda).
  const placasSemSkuRows = (await sql`
    SELECT p.id, p.numero, p.nome, p.papel, p.grupo_composto, p.tier
    FROM placas p
    WHERE p.descontinuada = false
      AND NOT EXISTS (SELECT 1 FROM sku_placa sp WHERE sp.placa_id = p.id)
    ORDER BY p.numero ASC
  `) as PlacaSemSkuRow[];

  const placasSemSku = placasSemSkuRows.map((p) => ({
    placaId: p.id,
    placaNumero: p.numero,
    placaNome: p.nome,
    papel: p.papel,
    grupoComposto: p.grupo_composto,
    tier: p.tier,
  }));

  return NextResponse.json({ produtos, placasSemSku });
}
