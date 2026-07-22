import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Consumo de filamento (aba Produção): quanto já foi impresso com
// sucesso e quanto já foi desperdiçado, em gramas, desde sempre.
//
// "Impresso" só consegue ser calculado pra placas com peso/placa (g) já
// cadastrado (campo `placas.peso_placa_gramas`, editável na tela de
// Produção) — por isso o número real tende a estar SUBESTIMADO enquanto
// nem todas as placas tiverem esse dado confirmado. Expomos
// `placasSemPeso`/`totalPlacas` pra deixar isso visível na tela em vez
// de mostrar um número "completo" que na verdade não é.
//
// "Desperdiçado" já era rastreado desde a v21 (falha de placa inteira +
// falha de peça avulsa) — aqui só somamos os dois de uma vez:
// - `producoes.gramas_desperdicadas`: preenchido quando o operador marca
//   "falha na placa" (aborta a impressão inteira, digita quanto foi
//   perdido).
// - `falhas_peca.gramas`: cada peça individual descartada numa placa que
//   continuou imprimindo normalmente.
export async function GET() {
  const [impressoRows, desperdicoPlacaRows, desperdicoPecaRows, cobertura] =
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
    ]);

  const gramasImpressas = Number((impressoRows as { total: string }[])[0]?.total ?? 0);
  const gramasDesperdicadasPlaca = Number(
    (desperdicoPlacaRows as { total: string }[])[0]?.total ?? 0
  );
  const gramasDesperdicadasPeca = Number(
    (desperdicoPecaRows as { total: string }[])[0]?.total ?? 0
  );
  const { sem_peso: placasSemPeso, total: totalPlacas } = (
    cobertura as { sem_peso: string; total: string }[]
  )[0];

  return NextResponse.json({
    gramasImpressas,
    gramasDesperdicadas: gramasDesperdicadasPlaca + gramasDesperdicadasPeca,
    gramasDesperdicadasPlaca,
    gramasDesperdicadasPeca,
    placasSemPeso: Number(placasSemPeso),
    totalPlacas: Number(totalPlacas),
  });
}
