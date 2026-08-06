import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Renomear impressora — pedido do Guilherme em 2026-08-04, junto com o
// POST de cadastro em /api/machines: "tem que colocar um botão de + e de
// renomear as impressoras". Self-service pela aba Produção (botão de
// editar no card de cada impressora), sem precisar pedir pra mim toda
// vez que troca o nome/numeração de uma máquina.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await req.json();
  const nome = String(body.nome ?? "").trim();
  if (!nome) {
    return NextResponse.json({ error: "Informe um nome pra impressora." }, { status: 400 });
  }

  const rows = (await sql`
    UPDATE machines SET nome = ${nome} WHERE id = ${id}
    RETURNING id, nome, ativa
  `) as { id: number; nome: string; ativa: boolean }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "Impressora não encontrada." }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

// Remover impressora — sem UI própria por enquanto (o pedido original era
// só "+" e renomear), mas útil pra corrigir cadastro errado sem precisar
// mexer direto no banco. Bloqueia se a máquina tiver produção em andamento
// pra não perder rastro de uma impressão real em progresso.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const emAndamento = (await sql`
    SELECT id FROM producoes WHERE machine_id = ${id} AND status = 'em_andamento'
  `) as { id: number }[];
  if (emAndamento.length > 0) {
    return NextResponse.json(
      { error: "Essa impressora tem uma produção em andamento — conclua ou cancele antes de remover." },
      { status: 409 }
    );
  }

  const rows = (await sql`
    DELETE FROM machines WHERE id = ${id} RETURNING id
  `) as { id: number }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "Impressora não encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
