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
// falha de peça avulsa) — aqui somamos os três:
// - `producoes.gramas_desperdicadas`: preenchido quando o operador marca
//   "falha na placa" (aborta a impressão inteira, digita quanto foi
//   perdido).
// - `falhas_peca.gramas`: cada peça individual descartada numa placa que
//   continuou imprimindo normalmente.
// - `perdas_filamento_manual.gramas`: perda avulsa registrada à parte
//   (2026-07-26) — cobre perda que não veio de uma produção rastreada
//   (purga, calibração, filamento emaranhado etc.), com a cor de cada
//   registro (ver /api/producao/perda-filamento).
// Garante a tabela de perdas avulsas antes de consultá-la — evita que
// essa rota (chamada o tempo todo pela aba Produção) quebre com "relation
// does not exist" caso a migração da rota /api/producao/perda-filamento
// ainda não tenha sido criada nesse ambiente. Idempotente e rápida.
async function garantirTabelaPerdaManual() {
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
  await garantirTabelaPerdaManual();

  const [
    impressoRows,
    desperdicoPlacaRows,
    desperdicoPecaRows,
    desperdicoManualRows,
    cobertura,
    manualRows,
    falhaRows,
  ] = await Promise.all([
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
        SELECT COALESCE(SUM(gramas), 0) AS total FROM perdas_filamento_manual
      `,
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
      // Taxa de falha real: peças rodadas (concluída ou falha_placa) vs
      // peças com falha. Numa produção com falha_placa a placa inteira é
      // considerada perdida (não credita nada no estoque, então todas as
      // peças daquela placa contam como falha). Numa produção concluída,
      // só as peças avulsas marcadas em falhas_peca contam como falha —
      // o resto foi creditado normalmente no estoque.
      sql`
        SELECT
          COALESCE(SUM(pr.quantidade_placas * pl.pecas_por_placa), 0) AS pecas_rodadas,
          COALESCE(SUM(
            CASE
              WHEN pr.status = 'falha_placa' THEN pr.quantidade_placas * pl.pecas_por_placa
              ELSE COALESCE(fp.count, 0)
            END
          ), 0) AS pecas_com_falha
        FROM producoes pr
        JOIN placas pl ON pl.id = pr.placa_id
        LEFT JOIN (
          SELECT producao_id, count(*) AS count FROM falhas_peca GROUP BY producao_id
        ) fp ON fp.producao_id = pr.id
        WHERE pr.status IN ('concluida', 'falha_placa')
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
  const gramasDesperdicadasManual = Number(
    (desperdicoManualRows as { total: string }[])[0]?.total ?? 0
  );
  const { sem_peso: placasSemPeso, total: totalPlacas } = (
    cobertura as { sem_peso: string; total: string }[]
  )[0];
  const gramasImpressasManual = Number(
    (manualRows as { gramas_impressas_manual: string }[])[0]?.gramas_impressas_manual ?? 0
  );

  const { pecas_rodadas: pecasRodadas, pecas_com_falha: pecasComFalha } = (
    falhaRows as { pecas_rodadas: string; pecas_com_falha: string }[]
  )[0];
  const pecasRodadasNum = Number(pecasRodadas);
  const pecasComFalhaNum = Number(pecasComFalha);
  const gramasDesperdicadasTotal =
    gramasDesperdicadasPlaca + gramasDesperdicadasPeca + gramasDesperdicadasManual;
  const gramasImpressasTotal = gramasImpressasCalculadas + gramasImpressasManual;
  const gramasConsumidasTotal = gramasImpressasTotal + gramasDesperdicadasTotal;
  // Taxa de falha REAL da operação (2026-08-15, pedido do Guilherme): por
  // peso de filamento perdido, não por contagem de peças — uma peça grande
  // que falha pesa muito mais que uma pequena, e o que importa pro
  // prejuízo real da operação é o material desperdiçado.
  const percentualFalha =
    gramasConsumidasTotal > 0
      ? (gramasDesperdicadasTotal / gramasConsumidasTotal) * 100
      : 0;
  const percentualImpresso = gramasConsumidasTotal > 0 ? 100 - percentualFalha : 0;
  // Mantido só como referência/comparação — não é mais a taxa oficial.
  const percentualFalhaPecas =
    pecasRodadasNum > 0 ? (pecasComFalhaNum / pecasRodadasNum) * 100 : 0;

  return NextResponse.json({
    gramasImpressas: gramasImpressasTotal,
    gramasImpressasCalculadas,
    gramasImpressasManual,
    gramasDesperdicadas: gramasDesperdicadasTotal,
    gramasDesperdicadasPlaca,
    gramasDesperdicadasPeca,
    gramasDesperdicadasManual,
    placasSemPeso: Number(placasSemPeso),
    totalPlacas: Number(totalPlacas),
    pecasRodadas: pecasRodadasNum,
    pecasComFalha: pecasComFalhaNum,
    percentualFalha,
    percentualImpresso,
    percentualFalhaPecas,
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
