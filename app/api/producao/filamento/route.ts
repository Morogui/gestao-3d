import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO_TODAS, CorFilamentoTodas } from "@/lib/placas";

// Estoque de filamento por cor+material (PLA/PETG). O que ficar zerado
// não sobe produto pra fila de prioridade (ver corFilamentoDaPlaca em
// lib/placas.ts). Lista completa: CORES_FILAMENTO_TODAS.
export const dynamic = "force-dynamic";

export type EstoqueFilamento = Record<CorFilamentoTodas, number>;

export async function GET() {
  const rows = (await sql`
    SELECT cor, quantidade_gramas FROM estoque_filamento
  `) as { cor: string; quantidade_gramas: string }[];

  const porCor = new Map(rows.map((r) => [r.cor, Number(r.quantidade_gramas)]));
  const resultado = {} as EstoqueFilamento;
  for (const cor of CORES_FILAMENTO_TODAS) {
    resultado[cor] = porCor.get(cor) ?? 0;
  }
  return NextResponse.json(resultado);
}

// Loga o ajuste manual do "Salvar estoque de filamento" (histórico de
// movimentação).
async function garantirTabelaAjustes() {
  await sql`
    CREATE TABLE IF NOT EXISTS ajustes_manuais_filamento (
      id SERIAL PRIMARY KEY,
      cor TEXT NOT NULL,
      delta NUMERIC NOT NULL,
      resultante NUMERIC NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as Partial<EstoqueFilamento>;
  await garantirTabelaAjustes();

  const atuaisRows = (await sql`
    SELECT cor, quantidade_gramas FROM estoque_filamento
  `) as { cor: string; quantidade_gramas: string }[];
  const atuaisPorCor = new Map(atuaisRows.map((r) => [r.cor, Number(r.quantidade_gramas)]));

  for (const cor of CORES_FILAMENTO_TODAS) {
    if (!(cor in body)) continue;
    const valor = Math.max(0, Number(body[cor]) || 0);
    const anterior = atuaisPorCor.get(cor) ?? 0;
    await sql`
      INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
      VALUES (${cor}, ${valor}, now())
      ON CONFLICT (cor) DO UPDATE
      SET quantidade_gramas = ${valor}, atualizado_em = now()
    `;
    const delta = valor - anterior;
    if (delta !== 0) {
      await sql`
        INSERT INTO ajustes_manuais_filamento (cor, delta, resultante)
        VALUES (${cor}, ${delta}, ${valor})
      `;
    }
  }

  const rows = (await sql`
    SELECT cor, quantidade_gramas FROM estoque_filamento
  `) as { cor: string; quantidade_gramas: string }[];
  const porCor = new Map(rows.map((r) => [r.cor, Number(r.quantidade_gramas)]));
  const resultado = {} as EstoqueFilamento;
  for (const cor of CORES_FILAMENTO_TODAS) {
    resultado[cor] = porCor.get(cor) ?? 0;
  }
  return NextResponse.json(resultado);
}
