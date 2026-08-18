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
  placa_id: number | null;
};

function toProdutoInput(row: ProdutoRow): ProdutoInput {
  return {
    id: String(row.id),
    nome: row.nome,
    sku: row.sku ?? "",
    pesoPlacaG: Number(row.peso_placa_g),
    tempoPlacaH: Number(row.tempo_placa_h),
    pecasNaPlaca: Number(row.pecas_na_placa),
    placaId: row.placa_id,
  };
}

// Pedido do Guilherme em 2026-08-18: "sempre que cadastrado um produto
// novo, deve ser vinculado sempre de forma automatico pela SKU do
// produto cadastrado" — ate aqui, "produtos" (aba Custo, so pra
// calculadora de custo) e "placas" (catalogo real de producao, usado
// pelo casamento de vendas em lib/demanda.ts) eram tabelas totalmente
// separadas: cadastrar um produto na aba Custo nunca criava a placa
// correspondente, entao a venda desse produto nunca batia com nada
// (bug real reportado: "Regua Bolo 5x10" cadastrado no Custo, com peso
// e tempo preenchidos, nunca apareceu em Producao). Esta funcao cria a
// placa (+ o mapeamento sku_placa) automaticamente a partir dos dados
// que o Guilherme ja preenche na aba Custo — sem cadastro duplicado.
async function garantirColunaPlacaId() {
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS placa_id integer REFERENCES placas(id)`;
}

async function criarPlacaParaProduto(params: {
  nome: string;
  sku: string | null;
  pesoPlacaG: number;
  tempoPlacaH: number;
  pecasNaPlaca: number;
}): Promise<number> {
  const { nome, sku, pesoPlacaG, tempoPlacaH, pecasNaPlaca } = params;
  const [{ proximo }] = (await sql`
    SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM placas
  `) as { proximo: number }[];
  const [placa] = (await sql`
    INSERT INTO placas (
      numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
      frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
      descontinuada, peso_placa_gramas, dados_confirmados
    )
    VALUES (
      ${proximo}, ${nome}, 'direta', null, null, ${sku || nome},
      null, ${pecasNaPlaca}, ${tempoPlacaH}, 'C',
      false, ${pesoPlacaG}, true
    )
    RETURNING id
  `) as { id: number }[];
  if (sku) {
    await sql`
      INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
      SELECT ${sku}, ${placa.id}, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placa.id}
      )
    `;
  }
  return placa.id;
}

export async function GET() {
  await garantirColunaPlacaId();
  const rows = (await sql`
    SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa, placa_id
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

  await garantirColunaPlacaId();

  const rows = (await sql`
    INSERT INTO produtos (nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa)
    VALUES (${nome}, ${sku || null}, ${pesoPlacaG}, ${tempoPlacaH}, ${pecasNaPlaca})
    RETURNING id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
  `) as ProdutoRow[];

  const placaId = await criarPlacaParaProduto({
    nome,
    sku: sku || null,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
  });
  await sql`UPDATE produtos SET placa_id = ${placaId} WHERE id = ${rows[0].id}`;

  return NextResponse.json(toProdutoInput(rows[0]), { status: 201 });
}
