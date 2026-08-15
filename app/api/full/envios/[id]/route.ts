import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Coluna adicionada em 2026-07-31 — ver nota completa em
// ../route.ts::garantirColunaPecasPorUnidade. Duplicada aqui (mesmo
// padrão já usado pra outras colunas "on-demand" nesse projeto) porque
// esta rota pode ser chamada isoladamente (ex: teste direto via fetch)
// sem passar primeiro pelo GET/POST de ../route.ts.
async function garantirColunaPecasPorUnidade() {
  await sql`ALTER TABLE full_envios ADD COLUMN IF NOT EXISTS pecas_por_unidade INTEGER NOT NULL DEFAULT 1`;
}

async function garantirColunaTituloMl() {
  await sql`ALTER TABLE full_envios ADD COLUMN IF NOT EXISTS titulo_ml TEXT`;
}

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
  const status = body.status as string | undefined;

  if (!id) {
    return NextResponse.json({ error: "Informe um id válido." }, { status: 400 });
  }

  await garantirColunaPecasPorUnidade();
  await garantirColunaTituloMl();

  // Edição de quantidade/data limite — pedido do Guilherme em 2026-07-27:
  // "eu coloquei errado e não tem como editar". Só é permitido enquanto o
  // envio ainda está "pendente" — depois de confirmado, a baixa de
  // estoque já aconteceu, e mudar a quantidade aqui não desfaria/refaria
  // aquela baixa (por isso o WHERE status = 'pendente' abaixo).
  if (status === undefined) {
    const quantidade = body.quantidade !== undefined ? Number(body.quantidade) : null;
    const dataLimite = body.dataLimite !== undefined ? String(body.dataLimite).trim() : null;
    const tituloMl = body.tituloMl !== undefined ? String(body.tituloMl).trim() : null;

    if (quantidade === null && dataLimite === null) {
      return NextResponse.json(
        { error: "Informe status, ou quantidade/dataLimite pra editar." },
        { status: 400 }
      );
    }
    if (quantidade !== null && (!Number.isFinite(quantidade) || quantidade <= 0)) {
      return NextResponse.json({ error: "quantidade inválida." }, { status: 400 });
    }

    const rows = await sql`
      UPDATE full_envios
      SET quantidade = COALESCE(${quantidade}, quantidade),
          data_limite = COALESCE(${dataLimite}, data_limite),
          titulo_ml = COALESCE(${tituloMl}, titulo_ml)
      WHERE id = ${id} AND status = 'pendente'
      RETURNING id, sku, placa_id, quantidade, data_limite, status, titulo_ml
    `;

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Envio não encontrado ou não está mais pendente (só dá pra editar antes de confirmar/cancelar)." },
        { status: 404 }
      );
    }
    return NextResponse.json(rows[0]);
  }

  if (status !== "confirmado" && status !== "cancelado") {
    return NextResponse.json(
      { error: "status precisa ser 'confirmado' ou 'cancelado'." },
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
  //
  // Bug corrigido em 2026-07-31 (pedido do Guilherme: "dei baixa agora em
  // 10 unidades do Box 6mm branco e ele não deu baixa de 30un do meu
  // estoque"): `quantidade` é o número de UNIDADES do SKU, não de peças
  // — pra SKUs de kit (ex: "3 SUPORTE BOX 6MM BRANCO", pecas_por_unidade
  // = 3 no catálogo sku_placa) a baixa real é quantidade × pecas_por_unidade.
  // Ver garantirColunaPecasPorUnidade em ../route.ts.
  const rows = (await sql`
    UPDATE full_envios
    SET status = 'confirmado', confirmado_em = now()
    WHERE id = ${id} AND status != 'confirmado'
    RETURNING id, status, confirmado_em, placa_id, quantidade, pecas_por_unidade
  `) as {
    id: number;
    status: string;
    confirmado_em: string;
    placa_id: number;
    quantidade: number;
    pecas_por_unidade: number | null;
  }[];

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
  // Ver nota acima — pecas é a baixa REAL em peças (unidades × multiplicador
  // do SKU), não a quantidade de unidades bruta.
  const pecas = Number(envio.quantidade) * Number(envio.pecas_por_unidade ?? 1);
  await sql`
    UPDATE estoque_placas
    SET quantidade_pecas = GREATEST(0, quantidade_pecas - ${pecas})
    WHERE placa_id = ${envio.placa_id}
  `;
  await sql`
    INSERT INTO baixas_estoque_full_envios (envio_id, placa_id, pecas)
    VALUES (${envio.id}, ${envio.placa_id}, ${pecas})
  `;

  return NextResponse.json({
    id: envio.id,
    status: envio.status,
    confirmado_em: envio.confirmado_em,
    pecasBaixadas: pecas,
  });
}
