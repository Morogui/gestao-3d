import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";

export const dynamic = "force-dynamic";

async function garantirColunas() {
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados_a2l BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS pecas_por_placa_a2l NUMERIC`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS tempo_placa_horas_a2l NUMERIC`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS peso_placa_gramas_a2l NUMERIC`;
}
export async function GET() {
  await garantirColunas();

  const rows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada, p.peso_placa_gramas, p.saida_extra_placa_id, p.saida_extra_pecas, p.dados_confirmados,
      p.dados_confirmados_a2l, p.pecas_por_placa_a2l, p.tempo_placa_horas_a2l, p.peso_placa_gramas_a2l,
      COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    WHERE p.descontinuada = false
    ORDER BY p.numero ASC
  `) as DbPlacaRow[];

  return NextResponse.json(rows.map(toPlacaRow));
}
