import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Configuração da aba Full — pedido do Guilherme em 2026-08-07: "o
// envio do full funciona todo produto vendido x 1.3 (esse valor temos
// que ter um campo para alterar)". Guarda um único multiplicador
// global, aplicado a todos os produtos na hora de calcular quanto
// enviar (ver /api/estoque-full: recomendacaoEnvio = vendidoFull7d ×
// multiplicador).
async function garantirTabela() {
  await sql`CREATE TABLE IF NOT EXISTS full_config (id SERIAL PRIMARY KEY, multiplicador NUMERIC NOT NULL DEFAULT 1.3)`;
  await sql`INSERT INTO full_config (multiplicador) SELECT 1.3 WHERE NOT EXISTS (SELECT 1 FROM full_config)`;
}

export async function GET() {
  await garantirTabela();
  const rows = (await sql`
    SELECT multiplicador FROM full_config ORDER BY id ASC LIMIT 1
  `) as { multiplicador: string }[];
  return NextResponse.json({ multiplicador: Number(rows[0]?.multiplicador ?? 1.3) });
}

export async function PATCH(request: NextRequest) {
  await garantirTabela();
  const body = await request.json();
  const multiplicador = Number(body.multiplicador);

  if (!Number.isFinite(multiplicador) || multiplicador <= 0) {
    return NextResponse.json(
      { error: "multiplicador precisa ser um número maior que 0." },
      { status: 400 }
    );
  }

  const rows = (await sql`SELECT id FROM full_config ORDER BY id ASC LIMIT 1`) as { id: number }[];
  if (rows.length === 0) {
    await sql`INSERT INTO full_config (multiplicador) VALUES (${multiplicador})`;
  } else {
    await sql`UPDATE full_config SET multiplicador = ${multiplicador} WHERE id = ${rows[0].id}`;
  }

  return NextResponse.json({ multiplicador });
}
