import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

async function garantirColunasManutencao() {
  await sql`ALTER TABLE machines ADD COLUMN IF NOT EXISTS em_manutencao boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE machines ADD COLUMN IF NOT EXISTS manutencao_inicio timestamptz`;
}

// Renomear impressora - pedido do Guilherme em 2026-08-04, junto com o
// POST de cadastro em /api/machines: "tem que colocar um botao de + e de
// renomear as impressoras". Self-service pela aba Producao (botao de
// editar no card de cada impressora), sem precisar pedir pra mim toda
// vez que troca o nome/numeracao de uma maquina.
//
// Tambem aceita { emManutencao: true|false } - pedido do Guilherme em
// 2026-08-17: botao pra marcar a impressora em manutencao (guarda o
// horario que comecou em manutencao_inicio; ver POST em
// /api/machines/[id]/manutencao pra registrar as horas paradas quando
// ela volta, que fecha o ciclo e zera manutencao_inicio de novo).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  await garantirColunasManutencao();
  const body = await req.json();

  if (typeof body.emManutencao === "boolean") {
    const rows = body.emManutencao
      ? ((await sql`
          UPDATE machines
          SET em_manutencao = true, manutencao_inicio = now()
          WHERE id = ${id}
          RETURNING id, nome, ativa, em_manutencao, manutencao_inicio
        `) as { id: number; nome: string; ativa: boolean; em_manutencao: boolean; manutencao_inicio: string | null }[])
      : ((await sql`
          UPDATE machines
          SET em_manutencao = false, manutencao_inicio = NULL
          WHERE id = ${id}
          RETURNING id, nome, ativa, em_manutencao, manutencao_inicio
        `) as { id: number; nome: string; ativa: boolean; em_manutencao: boolean; manutencao_inicio: string | null }[]);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Impressora nao encontrada." }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  }

  const nome = String(body.nome ?? "").trim();
  if (!nome) {
    return NextResponse.json({ error: "Informe um nome pra impressora." }, { status: 400 });
  }

  const rows = (await sql`
    UPDATE machines SET nome = ${nome} WHERE id = ${id}
    RETURNING id, nome, ativa, em_manutencao, manutencao_inicio
  `) as { id: number; nome: string; ativa: boolean; em_manutencao: boolean; manutencao_inicio: string | null }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "Impressora nao encontrada." }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

// Remover impressora - sem UI propria por enquanto (o pedido original era
// so "+" e renomear), mas util pra corrigir cadastro errado sem precisar
// mexer direto no banco. Bloqueia se a maquina tiver producao em andamento
// pra nao perder rastro de uma impressao real em progresso.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  const emAndamento = (await sql`
    SELECT id FROM producoes WHERE machine_id = ${id} AND status = 'em_andamento'
  `) as { id: number }[];
  if (emAndamento.length > 0) {
    return NextResponse.json(
      { error: "Essa impressora tem uma producao em andamento - conclua ou cancele antes de remover." },
      { status: 409 }
    );
  }

  const rows = (await sql`
    DELETE FROM machines WHERE id = ${id} RETURNING id
  `) as { id: number }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "Impressora nao encontrada." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
