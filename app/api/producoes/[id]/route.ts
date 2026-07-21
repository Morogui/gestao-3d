import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Marca uma produção como concluída (credita o estoque da placa) ou
// cancelada (não credita nada). É aqui que a peça "sai da impressora e
// entra no estoque".
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const { status } = body as { status: "concluida" | "cancelada" };

  if (status === "cancelada") {
    await sql`
      UPDATE producoes SET status = 'cancelada'
      WHERE id = ${id} AND status = 'em_andamento'
    `;
    return NextResponse.json({ ok: true });
  }

  if (status === "concluida") {
    const rows = (await sql`
      UPDATE producoes
      SET status = 'concluida', concluido_em = now()
      WHERE id = ${id} AND status = 'em_andamento'
      RETURNING placa_id, quantidade_placas
    `) as { placa_id: number; quantidade_placas: string }[];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "produção não encontrada ou já concluída" },
        { status: 404 }
      );
    }

    const { placa_id: placaId, quantidade_placas: quantidadePlacas } = rows[0];
    const placaRows = (await sql`
      SELECT pecas_por_placa FROM placas WHERE id = ${placaId}
    `) as { pecas_por_placa: string }[];
    const pecasPorPlaca = Number(placaRows[0]?.pecas_por_placa ?? 0);
    const pecasProduzidas = Number(quantidadePlacas) * pecasPorPlaca;

    await sql`
      UPDATE estoque_placas
      SET quantidade_pecas = quantidade_pecas + ${pecasProduzidas}, atualizado_em = now()
      WHERE placa_id = ${placaId}
    `;

    return NextResponse.json({ ok: true, pecasProduzidas });
  }

  return NextResponse.json({ error: "status inválido" }, { status: 400 });
}
