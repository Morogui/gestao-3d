import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-29). Até agora, /api/estoque/sincronizar-vendas
// dava baixa no estoque físico local (estoque_placas) pra QUALQUER venda
// que contasse como "vendida" — inclusive vendas do Full. Isso duplicava
// o desconto: a peça já tinha saído do estoque local no momento em que o
// ENVIO pro Full foi confirmado (ver PATCH /api/full/envios/[id]), então
// descontar de novo na hora da venda em si tirava a mesma peça 2x do
// número mostrado no painel. A partir de agora (ver mudança em
// sincronizar-vendas/route.ts) vendas do Full não geram mais baixa
// nenhuma no estoque local — mas isso não desfaz sozinho o que já tinha
// sido descontado errado até aqui.
//
// Esta rota corrige o passado: encontra toda linha em baixas_estoque_vendas
// que pertence a um pedido cujo shipping_mode (em pedidos_cache) é "Full",
// devolve as peças pro estoque local (estoque_placas) e apaga a linha —
// mesma mecânica de reversão já usada em sincronizar-vendas quando um
// pedido "desvende" (cancelado/estornado). Idempotente: uma vez apagada a
// linha de baixas_estoque_vendas, rodar de novo não encontra mais nada
// pra reverter.
export async function POST() {
  const paraReverter = (await sql`
    SELECT b.id, b.placa_id, b.pecas, b.plataforma, b.pedido_id
    FROM baixas_estoque_vendas b
    JOIN pedidos_cache pc
      ON pc.plataforma = b.plataforma AND pc.pedido_id = b.pedido_id
    WHERE pc.shipping_mode = 'Full'
  `) as {
    id: number;
    placa_id: number;
    pecas: number;
    plataforma: string;
    pedido_id: string;
  }[];

  const revertidas: { placaId: number; pecas: number; plataforma: string; pedidoId: string }[] =
    [];

  for (const row of paraReverter) {
    await sql`
      UPDATE estoque_placas
      SET quantidade_pecas = quantidade_pecas + ${row.pecas}, atualizado_em = now()
      WHERE placa_id = ${row.placa_id}
    `;
    await sql`DELETE FROM baixas_estoque_vendas WHERE id = ${row.id}`;
    revertidas.push({
      placaId: row.placa_id,
      pecas: row.pecas,
      plataforma: row.plataforma,
      pedidoId: row.pedido_id,
    });
  }

  const totalPecas = revertidas.reduce((s, r) => s + r.pecas, 0);

  return NextResponse.json({ ok: true, totalRevertidas: revertidas.length, totalPecas, revertidas });
}
