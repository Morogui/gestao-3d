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
