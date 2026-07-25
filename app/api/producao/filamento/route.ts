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

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as Partial<EstoqueFilamento>;

  for (const cor of CORES_FILAMENTO) {
    if (!(cor in body)) continue;
    const valor = Math.max(0, Number(body[cor]) || 0);
    await sql`
      INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
      VALUES (${cor}, ${valor}, now())
      ON CONFLICT (cor) DO UPDATE
      SET quantidade_gramas = ${valor}, atualizado_em = now()
    `;
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
