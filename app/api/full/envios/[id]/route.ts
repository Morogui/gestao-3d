import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Confirma (ou cancela) um envio planejado do Full. Pedido do Guilherme
// em 2026-07-25: "confirmando o envio do full no botão, essa produção
// sai da linha de frente" — ao confirmar, o envio para de contar como
// "pendente" e some da conta de faltantePlaca (ver GET em
// ../route.ts), o que automaticamente tira a prioridade extraordinária
// dessa placa na fila de produção.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const body = await request.json();
  const status = body.status as string;

  if (!id || (status !== "confirmado" && status !== "cancelado")) {
    return NextResponse.json(
      { error: "Informe um id válido e status 'confirmado' ou 'cancelado'." },
      { status: 400 }
    );
  }

  const rows = await sql`
    UPDATE full_envios
    SET status = ${status}, confirmado_em = CASE WHEN ${status} = 'confirmado' THEN now() ELSE confirmado_em END
    WHERE id = ${id}
    RETURNING id, status, confirmado_em
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
