import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
// Corrige a quantidade de pecas por placa quando o valor cadastrado nao
// bate com o que realmente saiu da impressora -- pedido do Guilherme em
// 2026-08-14, junto com a marca de "dados confirmados" que impede o
// popup de pedir correcao de novo pra essa placa (peso, tempo ou pecas
// -- qualquer correcao ja confirma a placa inteira). Atualiza
// pecas_por_placa da placa (dividido pela qtd de placas da producao),
// igual ao padrao ja usado em corrigir-filamento/corrigir-tempo.
async function garantirTabela() {
  await sql`
  CREATE TABLE IF NOT EXISTS correcoes_pecas (
  id SERIAL PRIMARY KEY,
  producao_id INTEGER NOT NULL,
  placa_id INTEGER NOT NULL,
  pecas_antigas NUMERIC NOT NULL,
  pecas_novas NUMERIC NOT NULL,
  delta_pecas NUMERIC NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `;
  await sql`
  ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados BOOLEAN NOT NULL DEFAULT false
  `;
}
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
  ) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  await garantirTabela();
  const body = await request.json();
  const pecasCorretas = Number(body?.pecasCorretas);
  if (!Number.isFinite(pecasCorretas) || pecasCorretas < 0) {
    return NextResponse.json(
      { error: "Informe pecasCorretas (>= 0)." },
      { status: 400 }
      );
  }
  const producaoRows = (await sql`
  SELECT placa_id, quantidade_placas, status
  FROM producoes WHERE id = ${id}
  `) as { placa_id: number; quantidade_placas: string; status: string }[];
  if (producaoRows.length === 0) {
    return NextResponse.json(
      { error: "producao nao encontrada" },
      { status: 404 }
      );
  }
  const producao = producaoRows[0];
  if (producao.status !== "concluida") {
    return NextResponse.json(
      { error: "so e possivel corrigir producoes concluidas" },
      { status: 400 }
      );
  }
  const placaRows = (await sql`
  SELECT pecas_por_placa FROM placas WHERE id = ${producao.placa_id}
  `) as { pecas_por_placa: number | null }[];
  if (placaRows.length === 0) {
    return NextResponse.json({ error: "placa nao encontrada" }, { status: 404 });
  }
  const placa = placaRows[0];
  const quantidadePlacas = Number(producao.quantidade_placas);
  const pecasAtual = placa.pecas_por_placa ? Number(placa.pecas_por_placa) : 0;
  const pecasAntigas = quantidadePlacas * pecasAtual;
  const delta = pecasCorretas - pecasAntigas;
  const pecasPlacaNovo =
    quantidadePlacas > 0 ? pecasCorretas / quantidadePlacas : pecasCorretas;
  await sql`
  UPDATE placas SET pecas_por_placa = ${pecasPlacaNovo}, dados_confirmados = true
  WHERE id = ${producao.placa_id}
  `;
  await sql`
  INSERT INTO correcoes_pecas
  (producao_id, placa_id, pecas_antigas, pecas_novas, delta_pecas)
  VALUES (${id}, ${producao.placa_id}, ${pecasAntigas}, ${pecasCorretas}, ${delta})
  `;
  return NextResponse.json({
    ok: true,
    pecasNovas: pecasCorretas,
    pecasPlacaNovo,
    delta,
  });
}
