import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEFAULT_PARAMS, GlobalParams } from "@/lib/custo";

export const dynamic = "force-dynamic";

type ParametrosRow = {
  id: number;
  preco_filamento_kg: string;
  energia_hora: string;
  manutencao_hora: string;
  falha_impressao: string;
};

function toGlobalParams(row: ParametrosRow): GlobalParams {
  return {
    precoFilamentoKg: Number(row.preco_filamento_kg),
    energiaHora: Number(row.energia_hora),
    manutencaoHora: Number(row.manutencao_hora),
    falhaImpressao: Number(row.falha_impressao),
  };
}

export async function GET() {
  const rows = (await sql`
    SELECT id, preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
    FROM parametros_globais
    ORDER BY id DESC
    LIMIT 1
  `) as ParametrosRow[];

  if (rows.length === 0) {
    return NextResponse.json(DEFAULT_PARAMS);
  }
  return NextResponse.json(toGlobalParams(rows[0]));
}

export async function PUT(request: NextRequest) {
  const body = (await request.json()) as GlobalParams;
  const { precoFilamentoKg, energiaHora, manutencaoHora, falhaImpressao } = body;

  const existing = (await sql`
    SELECT id FROM parametros_globais ORDER BY id DESC LIMIT 1
  `) as { id: number }[];

  let rows: ParametrosRow[];
  if (existing.length > 0) {
    rows = (await sql`
      UPDATE parametros_globais
      SET preco_filamento_kg = ${precoFilamentoKg},
          energia_hora = ${energiaHora},
          manutencao_hora = ${manutencaoHora},
          falha_impressao = ${falhaImpressao},
          atualizado_em = now()
      WHERE id = ${existing[0].id}
      RETURNING id, preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
    `) as ParametrosRow[];
  } else {
    rows = (await sql`
      INSERT INTO parametros_globais (preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao)
      VALUES (${precoFilamentoKg}, ${energiaHora}, ${manutencaoHora}, ${falhaImpressao})
      RETURNING id, preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
    `) as ParametrosRow[];
  }

  return NextResponse.json(toGlobalParams(rows[0]));
}
