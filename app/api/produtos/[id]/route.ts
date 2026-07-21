import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ProdutoInput } from "@/lib/custo";

export const dynamic = "force-dynamic";

type ProdutoRow = {
  id: number;
  nome: string;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
};

function toProdutoInput(row: ProdutoRow): ProdutoInput {
  return {
    id: String(row.id),
    nome: row.nome,
    pesoPlacaG: Number(row.peso_placa_g),
    tempoPlacaH: Number(row.tempo_placa_h),
    pecasNaPlaca: Number(row.pecas_na_placa),
  };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const { nome, pesoPlacaG, tempoPlacaH, pecasNaPlaca } = body as Omit<
    ProdutoInput,
    "id"
  >;

  const rows = (await sql`
    UPDATE produtos
    SET nome = ${nome},
        peso_placa_g = ${pesoPlacaG},
        tempo_placa_h = ${tempoPlacaH},
        pecas_na_placa = ${pecasNaPlaca}
    WHERE id = ${id}
    RETURNING id, nome, peso_placa_g, tempo_placa_h, pecas_na_placa
  `) as ProdutoRow[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  }

  return NextResponse.json(toProdutoInput(rows[0]));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  await sql`DELETE FROM produtos WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
