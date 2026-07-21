import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Registra a falha de UMA peça dentro de uma placa que continua
// imprimindo normalmente (não encerra a produção — isso é diferente de
// "falha na placa", que aborta tudo). A peça perdida é descontada do
// estoque creditado quando a produção for marcada como concluída.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const { pecaDescricao, gramas } = body as {
    pecaDescricao: string;
    gramas: number;
  };

  if (!pecaDescricao || !pecaDescricao.trim()) {
    return NextResponse.json(
      { error: "pecaDescricao é obrigatório" },
      { status: 400 }
    );
  }

  const producaoRows = await sql`
    SELECT id FROM producoes WHERE id = ${id} AND status = 'em_andamento'
  `;
  if (producaoRows.length === 0) {
    return NextResponse.json(
      { error: "produção não encontrada ou não está em andamento" },
      { status: 404 }
    );
  }

  const rows = await sql`
    INSERT INTO falhas_peca (producao_id, peca_descricao, gramas)
    VALUES (${id}, ${pecaDescricao.trim()}, ${gramas ?? 0})
    RETURNING id, producao_id, peca_descricao, gramas, criado_em
  `;

  return NextResponse.json(rows[0], { status: 201 });
}

// Lista as falhas de peça já registradas pra essa produção (usada pro
// card da impressora mostrar o histórico da placa em andamento).
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, producao_id, peca_descricao, gramas, criado_em
    FROM falhas_peca
    WHERE producao_id = ${id}
    ORDER BY criado_em DESC
  `;

  return NextResponse.json(rows);
}
