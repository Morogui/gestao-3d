import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Controle de manutencao - pedido do Guilherme em 2026-08-17: "coloque um
// botao nas impressoras de manutencao e no fim coloque a quantidade em
// horas que a impressora ficou parada, pra termos esse controle". Duas
// colunas novas em machines (em_manutencao + manutencao_inicio, marcadas
// quando a impressora entra em manutencao pela aba Producao) e uma tabela
// de historico (manutencoes_maquina) que guarda as horas paradas
// informadas manualmente quando ela volta - ver POST em
// /api/machines/[id]/manutencao. em_manutencao tambem tira a maquina da
// conta de maquinasAtivas() (lib/capacidade.ts), pra o calculo de
// capacidade do Full refletir de verdade quantas impressoras estao
// disponiveis.
async function garantirColunasManutencao() {
  await sql`ALTER TABLE machines ADD COLUMN IF NOT EXISTS em_manutencao boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE machines ADD COLUMN IF NOT EXISTS manutencao_inicio timestamptz`;
  await sql`
    CREATE TABLE IF NOT EXISTS manutencoes_maquina (
      id serial PRIMARY KEY,
      machine_id integer NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      horas_parada numeric NOT NULL,
      inicio timestamptz,
      fim timestamptz NOT NULL DEFAULT now(),
      observacao text
    )
  `;
}

export async function GET() {
  await garantirColunasManutencao();
  const rows = await sql`
    SELECT id, nome, ativa, em_manutencao, manutencao_inicio FROM machines ORDER BY id ASC
  `;
  return NextResponse.json(rows);
}

// Cadastrar impressora nova - pedido do Guilherme em 2026-08-04: "estou
// comprando mais [impressoras] e se ficar pedindo pra voce colocar toda
// hora vou perder tempo". Antes so dava pra adicionar uma maquina
// inserindo direto no banco (pedindo pra mim); agora e self-service pelo
// botao "+" na aba Producao (ver POST abaixo e PATCH em
// /api/machines/[id] pra renomear).
export async function POST(req: NextRequest) {
  await garantirColunasManutencao();
  const body = await req.json();
  const nome = String(body.nome ?? "").trim();

  if (!nome) {
    return NextResponse.json({ error: "Informe um nome pra impressora." }, { status: 400 });
  }

  const rows = (await sql`
    INSERT INTO machines (nome, ativa)
    VALUES (${nome}, true)
    RETURNING id, nome, ativa, em_manutencao, manutencao_inicio
  `) as { id: number; nome: string; ativa: boolean; em_manutencao: boolean; manutencao_inicio: string | null }[];

  return NextResponse.json(rows[0]);
}
