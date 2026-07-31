import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção (2026-07-31) — pedido do Guilherme depois de
// confirmar o envio #11 (Box 6mm Preto, 20 unidades) só de teste, pra me
// ajudar a achar o bug do multiplicador de kit: "Esse foi um teste que
// fiz, pode voltar esse envio para o full, pois não tenho a quantidade
// em estoque que precisa". Não existia (nem existe na UI ainda) um jeito
// de desfazer uma confirmação — só "Confirmar"/"Excluir" (que só cobre
// envios ainda pendentes). Esse "estorno" desfaz os 3 efeitos da
// confirmação (ver PATCH /api/full/envios/[id]):
//  1. Devolve pro estoque local exatamente o que foi descontado de
//     verdade (soma de baixas_estoque_full_envios pra esse envio — não
//     recalcula com o multiplicador certo, devolve o valor REAL que
//     tinha sido tirado, pra não criar uma peça do nada nem deixar
//     faltando).
//  2. Apaga a(s) linha(s) de baixas_estoque_full_envios desse envio (senão
//     ficaria um rastro de "Envio Full confirmado" no histórico da placa
//     e no extrato da aba Full pra uma confirmação que foi desfeita).
//  3. Volta o status do envio pra 'pendente' e limpa confirmado_em — o
//     envio reaparece na lista de "Envios planejados" normalmente, como
//     se nunca tivesse sido confirmado.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const envioId = Number(body.envioId);
  if (!Number.isInteger(envioId)) {
    return NextResponse.json({ error: "Informe envioId." }, { status: 400 });
  }

  const envioRows = (await sql`
    SELECT id, placa_id, status FROM full_envios WHERE id = ${envioId}
  `) as { id: number; placa_id: number; status: string }[];
  const envio = envioRows[0];
  if (!envio) {
    return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
  }
  if (envio.status !== "confirmado") {
    return NextResponse.json(
      { error: `Envio está com status '${envio.status}', não 'confirmado' — nada pra estornar.` },
      { status: 400 }
    );
  }

  const baixasRows = (await sql`
    SELECT COALESCE(SUM(pecas), 0)::int AS total FROM baixas_estoque_full_envios WHERE envio_id = ${envioId}
  `) as { total: number }[];
  const pecasDevolvidas = baixasRows[0]?.total ?? 0;

  if (pecasDevolvidas > 0) {
    await sql`
      UPDATE estoque_placas
      SET quantidade_pecas = quantidade_pecas + ${pecasDevolvidas}, atualizado_em = now()
      WHERE placa_id = ${envio.placa_id}
    `;
  }

  await sql`DELETE FROM baixas_estoque_full_envios WHERE envio_id = ${envioId}`;

  await sql`
    UPDATE full_envios SET status = 'pendente', confirmado_em = NULL WHERE id = ${envioId}
  `;

  return NextResponse.json({ ok: true, envioId, pecasDevolvidas, placaId: envio.placa_id });
}
