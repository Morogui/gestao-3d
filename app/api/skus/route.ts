import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Busca de SKU pra carregar uma placa fora da ordem da fila de
// prioridade (ex: "quero adiantar esse produto"). Usado pelo campo de
// busca no card de cada impressora na aba Produção.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json([]);
  }

  const rows = await sql`
    SELECT sp.sku, sp.placa_id, sp.pecas_por_unidade, pl.nome AS placa_nome, pl.numero AS placa_numero
    FROM sku_placa sp
    JOIN placas pl ON pl.id = sp.placa_id
    WHERE sp.sku ILIKE ${"%" + q + "%"}
    ORDER BY sp.sku
    LIMIT 20
  `;

  return NextResponse.json(rows);
}
