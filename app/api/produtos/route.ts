import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ProdutoInput } from "@/lib/custo";

export const dynamic = "force-dynamic";

type ProdutoRow = {
  id: number;
  nome: string;
  sku: string | null;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
};

function toProdutoInput(row: ProdutoRow): ProdutoInput {
  return {
    id: String(row.id),
    nome: row.nome,
    sku: row.sku ?? "",
    pesoPlacaG: Number(row.peso_placa_g),
    tempoPlacaH: Number(row.tempo_placa_h),
    pecasNaPlaca: Number(row.pecas_na_placa),
  };
}

export async function GET() {
  const rows = (await sql`
    SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
    FROM produtos
    ORDER BY nome ASC
  `) as ProdutoRow[];
  return NextResponse.json(rows.map(toProdutoInput));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { nome, sku, pesoPlacaG, tempoPlacaH, pecasNaPlaca } = body as Omit<
    ProdutoInput,
    "id"
  >;

  if (!nome || !nome.trim()) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }

  const rows = (await sql`
    INSERT INTO produtos (nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa)
    VALUES (${nome}, ${sku || null}, ${pesoPlacaG}, ${tempoPlacaH}, ${pecasNaPlaca})
    RETURNING id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
  `) as ProdutoRow[];

  return NextResponse.json(toProdutoInput(rows[0]), { status: 201 });
}
