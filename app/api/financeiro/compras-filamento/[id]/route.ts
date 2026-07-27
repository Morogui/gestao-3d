import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Remove uma compra de filamento lançada errada — recalcula o custo
// médio automaticamente (é sempre derivado ao vivo em GET
// /api/financeiro/compras-filamento, não guardado em cache).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const rows = await sql`
    DELETE FROM compras_filamento WHERE id = ${id} RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
