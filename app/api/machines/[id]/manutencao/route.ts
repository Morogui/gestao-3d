import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Registrar volta de manutencao - pedido do Guilherme em 2026-08-17:
// "coloque um botao nas impressoras de manutencao e no fim coloque a
// quantidade em horas que a impressora ficou parada, pra termos esse
// controle". Fecha o ciclo aberto por PATCH /api/machines/[id]
// { emManutencao: true }: grava o total de horas paradas informado
// manualmente (nao calculado sozinho, porque a impressora pode ficar
// "em manutencao" no sistema sem estar parada o tempo todo - ex:
// aguardando peca chegar) num historico e libera a maquina de novo.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  const body = await req.json();
  const horasParada = Number(body.horasParada);
  if (!Number.isFinite(horasParada) || horasParada < 0) {
    return NextResponse.json(
      { error: "Informe quantas horas a impressora ficou parada." },
      { status: 400 }
    );
  }
  const observacao = body.observacao ? String(body.observacao).trim() : null;

  const maquinaRows = (await sql`
    SELECT id, manutencao_inicio FROM machines WHERE id = ${id}
  `) as { id: number; manutencao_inicio: string | null }[];

  if (maquinaRows.length === 0) {
    return NextResponse.json({ error: "Impressora nao encontrada." }, { status: 404 });
  }

  await sql`
    INSERT INTO manutencoes_maquina (machine_id, horas_parada, inicio, fim, observacao)
    VALUES (${id}, ${horasParada}, ${maquinaRows[0].manutencao_inicio}, now(), ${observacao})
  `;

  const rows = (await sql`
    UPDATE machines
    SET em_manutencao = false, manutencao_inicio = NULL
    WHERE id = ${id}
    RETURNING id, nome, ativa, em_manutencao, manutencao_inicio
  `) as { id: number; nome: string; ativa: boolean; em_manutencao: boolean; manutencao_inicio: string | null }[];

  return NextResponse.json(rows[0]);
}

// Historico de manutencoes da impressora - ultimas 10, mais recente primeiro.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, horas_parada, inicio, fim, observacao
    FROM manutencoes_maquina
    WHERE machine_id = ${id}
    ORDER BY fim DESC
    LIMIT 10
  `;

  return NextResponse.json(rows);
}
