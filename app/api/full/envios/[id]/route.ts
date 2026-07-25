import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Confirma (ou cancela) um envio planejado do Full. Pedido do Guilherme
// em 2026-07-25: "confirmando o envio do full no botão, essa produção
// sai da linha de frente" — ao confirmar, o envio para de contar como
// "pendente" e some da conta de faltantePlaca (ver GET em
// ../route.ts), o que automaticamente tira a prioridade extraordinária
// dessa placa na fila de produção.
//
// Atualizado em 2026-07-26 — segundo pedido do Guilherme: "o estoque
// total do envio do full se deve dar baixa do meu estoque, somente
// quando eu confirmar... até mesmo para uma gestão melhor de estoque".
// Ou seja: a peça produzida entra no estoque local normal (como
// qualquer produção concluída — ver PATCH /api/producoes/[id]), mas só
// sai de fato do estoque local no momento em que o envio pro Full é
// CONFIRMADO aqui (não quando é criado/planejado) — é o instante em que
// as peças fisicamente saem da prateleira local rumo ao Full. Mesmo
// padrão de baixa já usado pra vendas (baixas_estoque_vendas) e visível
// no histórico da aba Estoque.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  const body = await request.json();
  const status = body.status as string;

  if (!id || (status !== "confirmado" && status !== "cancelado")) {
    return NextResponse.json(
      { error: "Informe um id válido e status 'confirmado' ou 'cancelado'." },
      { status: 400 }
    );
  }

  if (status === "cancelado") {
    const rows = await sql`
      UPDATE full_envios
      SET status = 'cancelado'
      WHERE id = ${id}
      RETURNING id, status, confirmado_em
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  }

  // status === "confirmado" — guard "AND status != 'confirmado'" evita
  // dar baixa 2x se o botão for clicado de novo (ex: duplo clique,
  // requisição repetida) num envio que já tinha sido confirmado antes.
  const rows = (await sql`
    UPDATE full_envios
    SET status = 'confirmado', confirmado_em = now()
    WHERE id = ${id} AND status != 'confirmado'
    RETURNING id, status, confirmado_em, placa_id, quantidade
  `) as { id: number; status: string; confirmado_em: string; placa_id: number; quantidade: number }[];

  if (rows.length === 0) {
    // Ou o envio não existe, ou já estava confirmado (idempotente: não é
    // erro, só não repete a baixa de estoque).
    const existente = (await sql`
      SELECT id, status, confirmado_em FROM full_envios WHERE id = ${id}
    `) as { id: number; status: string; confirmado_em: string }[];
    if (existente.length === 0) {
      return NextResponse.json({ error: "Envio não encontrado." }, { status: 404 });
    }
    return NextResponse.json(existente[0]);
  }

  const envio = rows[0];
  await sql`
    UPDATE estoque_placas
    SET quantidade_pecas = GREATEST(0, quantidade_pecas - ${envio.quantidade})
    WHERE placa_id = ${envio.placa_id}
  `;
  await sql`
    INSERT INTO baixas_estoque_full_envios (envio_id, placa_id, pecas)
    VALUES (${envio.id}, ${envio.placa_id}, ${envio.quantidade})
  `;

  return NextResponse.json({
    id: envio.id,
    status: envio.status,
    confirmado_em: envio.confirmado_em,
  });
}
