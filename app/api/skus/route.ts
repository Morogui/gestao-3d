import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Busca de SKU pra carregar uma placa fora da ordem da fila de
// prioridade (ex: "quero adiantar esse produto"). Usado pelo campo de
// busca no card de cada impressora na aba Produção.
//
// Importante: aqui é busca pra IMPRESSÃO, não pra venda. Várias
// variações de SKU (cor, com/sem parafuso etc.) costumam apontar pra
// exatamente a mesma placa física — ex: SUPORTE SECADOR DE CABELO
// BRANCO/PRETO, com ou sem parafuso, são a mesma peça impressa, o
// parafuso é só embalagem. Por isso agrupamos o resultado por placa_id:
// cada placa aparece só uma vez na lista, não uma vez por SKU/variação.
// Placas diferentes (ex: corpo e gancho de um produto composto, que são
// impressões separadas) continuam aparecendo como itens distintos.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  // agrupar=false — pedido do Guilherme em 2026-07-27: a aba Full precisa
  // enxergar cada SKU REAL separado (ex: Suporte Secador de Cabelo tem 4
  // SKUs — Branco/Preto, com/sem parafuso —, todos a MESMA peça física
  // pra produção/estoque, mas 4 anúncios/SKUs distintos na hora de
  // planejar envio pro Full). O agrupamento por placa abaixo continua
  // sendo o padrão (usado pela busca de "carregar máquina" na aba
  // Produção, onde só importa qual placa imprimir).
  const agrupar = request.nextUrl.searchParams.get("agrupar") !== "false";

  const rows = (await sql`
    SELECT sp.sku, sp.placa_id, sp.pecas_por_unidade, pl.nome AS placa_nome, pl.numero AS placa_numero
    FROM sku_placa sp
    JOIN placas pl ON pl.id = sp.placa_id
    WHERE sp.sku ILIKE ${"%" + q + "%"}
    ORDER BY sp.sku
    LIMIT 100
  `) as {
    sku: string;
    placa_id: number;
    pecas_por_unidade: string;
    placa_nome: string;
    placa_numero: number;
  }[];

  if (!agrupar) {
    return NextResponse.json(
      rows.slice(0, 20).map((r) => ({ ...r, variacoes: 1 }))
    );
  }

  const porPlaca = new Map<
    number,
    { sku: string; placa_id: number; pecas_por_unidade: string; placa_nome: string; placa_numero: number; variacoes: number }
  >();
  for (const row of rows) {
    const existente = porPlaca.get(row.placa_id);
    if (existente) {
      existente.variacoes += 1;
    } else {
      porPlaca.set(row.placa_id, { ...row, variacoes: 1 });
    }
  }

  const resultado = Array.from(porPlaca.values())
    .sort((a, b) => a.placa_numero - b.placa_numero)
    .slice(0, 20);

  return NextResponse.json(resultado);
}
