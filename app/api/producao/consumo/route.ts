import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Consumo de filamento (aba Produção): quanto já foi impresso com
// sucesso e quanto já foi desperdiçado, em gramas, desde sempre.
//
// "Impresso" tem duas fontes que se somam:
// 1) Calculado automaticamente a partir das produções concluídas, só pra
//    placas com peso/placa (g) já cadastrado (campo
//    `placas.peso_placa_gramas`, editável na tela de Produção) — cresce
//    sozinho a partir de agora, conforme mais placas ganham peso
//    confirmado e mais produções são concluídas.
// 2) Um valor informado manualmente (`consumo_filamento_manual`), pra
//    cobrir tudo que já foi impresso ANTES desse cadastro de peso/placa
//    existir — sem isso, o total ficaria zerado do zero até hoje, o que
//    não reflete a operação real (o Guilherme já roda a operação há um
//    tempo). Editável na tela de Produção (em kg, por ser a unidade mais
//    prática pra declarar um total histórico).
//
// "Desperdiçado" já era rastreado desde a v21 (falha de placa inteira +
// falha de peça avulsa) — aqui só somamos os dois de uma vez:
// - `producoes.gramas_desperdicadas`: preenchido quando o operador marca
//   "falha na placa" (aborta a impressão inteira, digita quanto foi
//   perdido).
// - `falhas_peca.gramas`: cada peça individual descartada numa placa que
//   continuou imprimindo normalmente.
export async function GET() {
  const [impressoRows, desperdicoPlacaRows, desperdicoPecaRows, cobertura, manualRows] =
    await Promise.all([
      sql`
        SELECT COALESCE(SUM(pr.quantidade_placas * pl.peso_placa_gramas), 0) AS total
        FROM producoes pr
        JOIN placas pl ON pl.id = pr.placa_id
        WHERE pr.status = 'concluida' AND pl.peso_placa_gramas IS NOT NULL
      `,
      sql`
        SELECT COALESCE(SUM(gramas_desperdicadas), 0) AS total
        FROM producoes
        WHERE status = 'falha_placa'
      `,
      sql`SELECT COALESCE(SUM(gramas), 0) AS total FROM falhas_peca`,
      sql`
        SELECT
          count(*) FILTER (WHERE peso_placa_gramas IS NULL) AS sem_peso,
          count(*) AS total
        FROM placas
        WHERE descontinuada = false
      `,
      sql`
        SELECT gramas_impressas_manual
        FROM consumo_filamento_manual
        ORDER BY id DESC
        LIMIT 1
      `,
    ]);

  const gramasImpressasCalculadas = Number(
    (impressoRows as { total: string }[])[0]?.total ?? 0
  );
  const gramasDesperdicadasPlaca = Number(
    (desperdicoPlacaRows as { total: string }[])[0]?.total ?? 0
  );
  const gramasDesperdicadasPeca = Number(
    (desperdicoPecaRows as { total: string }[])[0]?.total ?? 0
  );
  const { sem_peso: placasSemPeso, total: totalPlacas } = (
    cobertura as { sem_peso: string; total: string }[]
  )[0];
  const gramasImpressasManual = Number(
    (manualRows as { gramas_impressas_manual: string }[])[0]?.gramas_impressas_manual ?? 0
  );

  return NextResponse.json({
    gramasImpressas: gramasImpressasCalculadas + gramasImpressasManual,
    gramasImpressasCalculadas,
    gramasImpressasManual,
    gramasDesperdicadas: gramasDesperdicadasPlaca + gramasDesperdicadasPeca,
    gramasDesperdicadasPlaca,
    gramasDesperdicadasPeca,
    placasSemPeso: Number(placasSemPeso),
    totalPlacas: Number(totalPlacas),
  });
}

// Define (valor absoluto, não delta) o total impresso informado
// manualmente — cobre o que já foi impresso antes do cadastro de
// peso/placa existir. Guilherme digita o total que ele sabe que já
// gastou até agora (ex: N kg de spools já consumidos) e o sistema soma
// isso ao que for calculado automaticamente daqui pra frente.
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { gramasImpressasManual } = body as { gramasImpressasManual: number };

  if (!Number.isFinite(gramasImpressasManual) || gramasImpressasManual < 0) {
    return NextResponse.json(
      { error: "gramasImpressasManual precisa ser um número >= 0" },
      { status: 400 }
    );
  }

  const existing = (await sql`
    SELECT id FROM consumo_filamento_manual ORDER BY id DESC LIMIT 1
  `) as { id: number }[];

  let rows: { gramas_impressas_manual: string }[];
  if (existing.length > 0) {
    rows = (await sql`
      UPDATE consumo_filamento_manual
      SET gramas_impressas_manual = ${gramasImpressasManual}, atualizado_em = now()
      WHERE id = ${existing[0].id}
      RETURNING gramas_impressas_manual
    `) as { gramas_impressas_manual: string }[];
  } else {
    rows = (await sql`
      INSERT INTO consumo_filamento_manual (gramas_impressas_manual)
      VALUES (${gramasImpressasManual})
      RETURNING gramas_impressas_manual
    `) as { gramas_impressas_manual: string }[];
  }

  return NextResponse.json({
    gramasImpressasManual: Number(rows[0].gramas_impressas_manual),
  });
}
