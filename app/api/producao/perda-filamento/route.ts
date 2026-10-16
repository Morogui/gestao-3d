import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO_TODAS, CorFilamentoTodas } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Registro de perda AVULSA de filamento (purga, calibração, carretel
// emaranhado etc.). Desconta na hora do estoque_filamento da cor e fica
// registrado pra somar em "Total já desperdiçado" (/api/producao/consumo).
async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS perdas_filamento_manual (
      id SERIAL PRIMARY KEY,
      cor TEXT NOT NULL,
      gramas INTEGER NOT NULL,
      motivo TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function GET() {
  await garantirTabela();
  const rows = (await sql`
    SELECT id, cor, gramas, motivo, criado_em
    FROM perdas_filamento_manual
    ORDER BY criado_em DESC
    LIMIT 20
  `) as { id: number; cor: string; gramas: number; motivo: string | null; criado_em: string }[];
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await garantirTabela();

  const body = await request.json();
  const cor = String(body.cor ?? "").toLowerCase() as CorFilamentoTodas;
  const gramas = Number(body.gramas);
  const motivo = body.motivo ? String(body.motivo).trim().slice(0, 200) : null;

  if (!CORES_FILAMENTO_TODAS.includes(cor)) {
    return NextResponse.json(
      { error: `Cor invalida. Use uma de: ${CORES_FILAMENTO_TODAS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(gramas) || gramas <= 0) {
    return NextResponse.json({ error: "Informe gramas (> 0)." }, { status: 400 });
  }

  const registro = (await sql`
    INSERT INTO perdas_filamento_manual (cor, gramas, motivo)
    VALUES (${cor}, ${gramas}, ${motivo})
    RETURNING id, cor, gramas, motivo, criado_em
  `) as { id: number; cor: string; gramas: number; motivo: string | null; criado_em: string }[];

  await sql`
    INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
    VALUES (${cor}, 0, now())
    ON CONFLICT (cor) DO NOTHING
  `;
  await sql`
    UPDATE estoque_filamento
    SET quantidade_gramas = GREATEST(0, quantidade_gramas - ${gramas}), atualizado_em = now()
    WHERE cor = ${cor}
  `;

  const estoqueRows = (await sql`
    SELECT cor, quantidade_gramas FROM estoque_filamento
  `) as { cor: string; quantidade_gramas: string }[];
  const porCor = new Map(estoqueRows.map((r) => [r.cor, Number(r.quantidade_gramas)]));
  const estoque = {} as Record<CorFilamentoTodas, number>;
  for (const c of CORES_FILAMENTO_TODAS) estoque[c] = porCor.get(c) ?? 0;

  return NextResponse.json({ registro: registro[0], estoque }, { status: 201 });
}
