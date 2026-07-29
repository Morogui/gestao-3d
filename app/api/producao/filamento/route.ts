import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO, CorFilamento } from "@/lib/placas";

// Estoque de filamento por cor — pedido do Guilherme em 2026-07-25: um
// campo simples onde ele informa quanto tem de cada cor (em gramas); o
// que ficar zerado não deve subir produto pra fila de prioridade (ver
// corFilamentoDaPlaca em lib/placas.ts e o filtro em
// app/producao/page.tsx). Só as 6 cores realmente controladas em
// estoque — outras cores do catálogo (cinza, laranja) não têm campo
// aqui e por isso nunca são bloqueadas.
export const dynamic = "force-dynamic";

export type EstoqueFilamento = Record<CorFilamento, number>;

export async function GET() {
  const rows = (await sql`
    SELECT cor, quantidade_gramas FROM estoque_filamento
  `) as { cor: string; quantidade_gramas: string }[];

  const porCor = new Map(rows.map((r) => [r.cor, Number(r.quantidade_gramas)]));
  const resultado = {} as EstoqueFilamento;
  for (const cor of CORES_FILAMENTO) {
    resultado[cor] = porCor.get(cor) ?? 0;
  }
  return NextResponse.json(resultado);
}

// Loga o ajuste manual do "Salvar estoque de filamento" — pedido do
// Guilherme em 2026-07-28 (aba de histórico de movimentação): antes essa
// PUT só sobrescrevia quantidade_gramas, sem deixar rastro nenhum de
// quanto mudou. Mesmo padrão de ajustes_manuais_estoque (aba Estoque).
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

  for (const cor of CORES_FILAMENTO) {
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
  for (const cor of CORES_FILAMENTO) {
    resultado[cor] = porCor.get(cor) ?? 0;
  }
  return NextResponse.json(resultado);
}
