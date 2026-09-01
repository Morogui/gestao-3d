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
  pecas_na_placa_a2l: string | null;
};

function toProdutoInput(row: ProdutoRow): ProdutoInput {
  return {
    id: String(row.id),
    nome: row.nome,
    sku: row.sku ?? "",
    pesoPlacaG: Number(row.peso_placa_g),
    tempoPlacaH: Number(row.tempo_placa_h),
    pecasNaPlaca: Number(row.pecas_na_placa),
    pecasNaPlacaA2l:
      row.pecas_na_placa_a2l === null || row.pecas_na_placa_a2l === undefined
        ? null
        : Number(row.pecas_na_placa_a2l),
  };
}

// Ver app/api/produtos/route.ts pra contexto completo do porque disto
// existe — mantem a placa de producao sincronizada com a edicao feita
// aqui na aba Custo, e cria a placa retroativamente (backfill) se esse
// produto foi cadastrado antes desse vinculo automatico existir (caso
// real: "Regua Bolo 5x10"/"3x10", cadastrados so no Custo, com peso e
// tempo ja preenchidos — a primeira edicao depois deste deploy cria a
// placa correspondente automaticamente, usando esses mesmos dados).
async function garantirColunaPlacaId() {
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS placa_id integer REFERENCES placas(id)`;
}

async function garantirColunaA2l() {
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pecas_na_placa_a2l NUMERIC`;
}

async function sincronizarPlaca(params: {
  placaId: number | null;
  nome: string;
  skuAntigo: string | null;
  skuNovo: string | null;
  pesoPlacaG: number;
  tempoPlacaH: number;
  pecasNaPlaca: number;
}): Promise<number> {
  const { placaId, nome, skuAntigo, skuNovo, pesoPlacaG, tempoPlacaH, pecasNaPlaca } = params;

  if (!placaId && skuNovo) {
    const existentes = (await sql`SELECT id FROM placas WHERE sku_ou_kit = ${skuNovo} LIMIT 1`) as { id: number }[];
    if (existentes.length > 0) {
      return existentes[0].id;
    }
  }

  if (!placaId) {
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
        ${proximo}, ${nome}, 'direta', null, null, ${skuNovo || nome},
        null, ${pecasNaPlaca}, ${tempoPlacaH}, 'C',
        false, ${pesoPlacaG}, true
      )
      RETURNING id
    `) as { id: number }[];
    if (skuNovo) {
      await sql`
        INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
        SELECT ${skuNovo}, ${placa.id}, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM sku_placa WHERE sku = ${skuNovo} AND placa_id = ${placa.id}
        )
      `;
    }
    return placa.id;
  }

  await sql`
    UPDATE placas
    SET nome = ${nome},
        sku_ou_kit = ${skuNovo || nome},
        pecas_por_placa = ${pecasNaPlaca},
        tempo_placa_horas = ${tempoPlacaH},
        peso_placa_gramas = ${pesoPlacaG}
    WHERE id = ${placaId}
  `;

  if (skuNovo && skuNovo !== skuAntigo) {
    await sql`
      INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
      SELECT ${skuNovo}, ${placaId}, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM sku_placa WHERE sku = ${skuNovo} AND placa_id = ${placaId}
      )
    `;
  }

  return placaId;
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
  const { nome, sku, pesoPlacaG, tempoPlacaH, pecasNaPlaca, pecasNaPlacaA2l } = body as Omit<
    ProdutoInput,
    "id"
  >;

  await garantirColunaPlacaId();
  await garantirColunaA2l();

  const antigoRows = (await sql`
    SELECT sku, placa_id FROM produtos WHERE id = ${id}
  `) as { sku: string | null; placa_id: number | null }[];
  if (antigoRows.length === 0) {
    return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  }

  const rows = (await sql`
    UPDATE produtos
    SET nome = ${nome},
        sku = ${sku || null},
        peso_placa_g = ${pesoPlacaG},
        tempo_placa_h = ${tempoPlacaH},
        pecas_na_placa = ${pecasNaPlaca},
        pecas_na_placa_a2l = ${pecasNaPlacaA2l || null}
    WHERE id = ${id}
    RETURNING id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa, pecas_na_placa_a2l
  `) as ProdutoRow[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  }

  const placaId = await sincronizarPlaca({
    placaId: antigoRows[0].placa_id,
    nome,
    skuAntigo: antigoRows[0].sku,
    skuNovo: sku || null,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
  });
  if (!antigoRows[0].placa_id) {
    await sql`UPDATE produtos SET placa_id = ${placaId} WHERE id = ${id}`;
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
