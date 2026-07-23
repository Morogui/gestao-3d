import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Igual à /api/placas, mas SEM o filtro "descontinuada = false" — a aba
// Estoque precisa mostrar e permitir ajustar manualmente até placas
// descontinuadas (ex: Taça Copa do Mundo, que não produzimos mais mas
// ainda vende o que sobrou em estoque).
export async function GET() {
  const rows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque,
      e.atualizado_em
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    ORDER BY p.numero ASC
  `) as (DbPlacaRow & { atualizado_em: string | null })[];

  return NextResponse.json(
    rows.map((row) => ({
      ...toPlacaRow(row),
      atualizadoEm: row.atualizado_em,
    }))
  );
}

// Ajuste manual de estoque — soma (ou subtrai, se negativo) "delta" ao
// quantidade_pecas atual da placa. Escreve direto na mesma tabela
// estoque_placas que a aba Produção lê/credita ao concluir uma
// impressão, então as duas telas ficam sempre em sincronia.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const placaId = Number(body.placaId);
  const delta = Number(body.delta);

  if (!placaId || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json(
      { error: "Informe placaId e um delta diferente de zero." },
      { status: 400 }
    );
  }

  // Nem toda placa necessariamente já tem uma linha em estoque_placas
  // (placas novas cadastradas depois podem ficar sem — foi o caso do
  // Suporte Secador de Cabelo Preto, cujo ajuste manual não gravava nada
  // e falhava em silêncio porque o UPDATE não achava linha nenhuma pra
  // atualizar). Por isso usamos INSERT ... ON CONFLICT (upsert): cria a
  // linha na hora se não existir, ou soma no delta se já existir —
  // funciona nos dois casos sem precisar de uma migração de backfill.
  const rows = (await sql`
    INSERT INTO estoque_placas (placa_id, quantidade_pecas, atualizado_em)
    VALUES (${placaId}, GREATEST(0, ${delta}), now())
    ON CONFLICT (placa_id) DO UPDATE
    SET quantidade_pecas = GREATEST(0, estoque_placas.quantidade_pecas + ${delta}), atualizado_em = now()
    RETURNING placa_id, quantidade_pecas, atualizado_em
  `) as { placa_id: number; quantidade_pecas: number; atualizado_em: string }[];

  return NextResponse.json(rows[0]);
}
