import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO } from "@/lib/placas";

export const dynamic = "force-dynamic";

interface CompraRow {
    id: number;
    cor: string;
    gramas: string;
    valor_pago: string;
    data_compra: string;
    data_vencimento: string;
    status: string;
    data_pagamento: string | null;
    fornecedor: string | null;
    criado_em: string;
    chegou: boolean;
    data_chegada: string | null;
    pedido_id: string | null;
}

function toPlainDate(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) {
          const y = v.getUTCFullYear();
          const m = String(v.getUTCMonth() + 1).padStart(2, "0");
          const d = String(v.getUTCDate()).padStart(2, "0");
          return `${y}-${m}-${d}`;
    }
    return String(v).slice(0, 10);
}

function serializar(r: CompraRow) {
    return {
          id: r.id,
          cor: r.cor,
          gramas: Number(r.gramas),
          valorPago: Number(r.valor_pago),
          dataCompra: toPlainDate(r.data_compra),
          dataVencimento: toPlainDate(r.data_vencimento ?? r.data_compra),
          status: r.status === "pendente" ? "pendente" : "pago",
          dataPagamento: toPlainDate(r.data_pagamento),
          fornecedor: r.fornecedor,
          criadoEm: r.criado_em,
          chegou: r.chegou,
          dataChegada: toPlainDate(r.data_chegada),
          pedidoId: r.pedido_id,
    };
}

// Marca uma compra de filamento a prazo como paga (ou volta pra
// pendente) — pedido do Guilherme em 2026-07-27: "Filamento pode ser a
// vista, com prazo para pagamwento entao tem que conseguir coloca o
// prazo". Mesmo padrão do PATCH de financeiro_lancamentos.
//
// Estendido em 2026-08-11: também confirma a CHEGADA física do pedido
// (campo `chegou`), independente do status de pagamento — pedido do
// Guilherme: "comprei filamento no dia 7, porem ele nao chegou... quando
// ele chegar eu conseguir lançar ele". Passa { chegou: true } (com
// dataChegada opcional) pra marcar como recebido — só nesse momento o
// peso é somado ao estoque_filamento (a compra em si pode ter sido
// lançada dias antes — pagamento, catálogo e custo médio já existem,
// só não entra no saldo físico até confirmar). Idempotente: confirmar
// de novo uma compra que já estava chegou=true não credita o estoque
// duas vezes.
export async function PATCH(
    request: NextRequest,
  { params }: { params: { id: string } }
  ) {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
          return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

  const body = await request.json();

  const temStatus = body.status !== undefined;
    const temChegou = body.chegou !== undefined;

  if (!temStatus && !temChegou) {
        return NextResponse.json(
          { error: "Informe 'status' (pago/pendente) e/ou 'chegou' (true/false)." },
          { status: 400 }
              );
  }
    if (temStatus && body.status !== "pago" && body.status !== "pendente") {
          return NextResponse.json({ error: "status deve ser 'pago' ou 'pendente'" }, { status: 400 });
    }
    if (temChegou && typeof body.chegou !== "boolean") {
          return NextResponse.json({ error: "chegou deve ser true ou false" }, { status: 400 });
    }

  const atuais = (await sql`SELECT * FROM compras_filamento WHERE id = ${id}`) as CompraRow[];
    if (atuais.length === 0) {
          return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });
    }
    const atual = atuais[0];

  const novoStatus = temStatus ? (body.status as string) : atual.status;
    const novaDataPagamento = temStatus
      ? novoStatus === "pago"
            ? body.dataPagamento
              ? String(body.dataPagamento).trim()
              : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
            : null
          : atual.data_pagamento;

  const chegouAntes = atual.chegou;
    const novoChegou = temChegou ? (body.chegou as boolean) : atual.chegou;
    const novaDataChegada = temChegou
      ? novoChegou
            ? body.dataChegada
              ? String(body.dataChegada).trim()
              : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
            : null
          : atual.data_chegada;

  const rows = (await sql`
      UPDATE compras_filamento
          SET status = ${novoStatus}, data_pagamento = ${novaDataPagamento}, chegou = ${novoChegou}, data_chegada = ${novaDataChegada}
              WHERE id = ${id}
                  RETURNING *
                    `) as CompraRow[];

  // Confirmando chegada agora (false -> true): credita o estoque com o
  // peso dessa compra, mesmo padrão do POST em
  // /api/financeiro/compras-filamento. Se já estava chegou=true, não
  // mexe de novo (evita duplicar). Se estava desmarcando (true -> false,
  // correção de um lançamento errado), desfaz o crédito.
  const cor = atual.cor;
    const gramas = Number(atual.gramas);
    if (CORES_FILAMENTO.includes(cor as (typeof CORES_FILAMENTO)[number]) && gramas > 0) {
          if (!chegouAntes && novoChegou) {
                  await sql`
                          INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
                                  VALUES (${cor}, ${gramas}, now())
                                          ON CONFLICT (cor) DO UPDATE
                                                  SET quantidade_gramas = estoque_filamento.quantidade_gramas + ${gramas}, atualizado_em = now()
                                                        `;
          } else if (chegouAntes && !novoChegou) {
                  await sql`
                          UPDATE estoque_filamento
                                  SET quantidade_gramas = GREATEST(0, quantidade_gramas - ${gramas}), atualizado_em = now()
                                          WHERE cor = ${cor}
                                                `;
          }
    }

  return NextResponse.json(serializar(rows[0]));
}

// Remove uma compra de filamento lançada errada — recalcula o custo
// médio automaticamente (é sempre derivado ao vivo em GET
// /api/financeiro/compras-filamento, não guardado em cache).
export async function DELETE(
    _request: NextRequest,
  { params }: { params: { id: string } }
  ) {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
          return NextResponse.json({ error: "id inválido" }, { status: 400 });
    }

  const rows = (await sql`
      DELETE FROM compras_filamento WHERE id = ${id} RETURNING id, cor, gramas, chegou
        `) as { id: number; cor: string; gramas: string; chegou: boolean }[];

  if (rows.length === 0) {
        return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });
  }

  // Desfaz a soma que essa compra tinha feito no estoque de filamento por
  // cor (ver POST em /api/financeiro/compras-filamento) — senão excluir
  // um lançamento errado deixaria o saldo inflado pra sempre. GREATEST(0,
  // ...) evita ficar negativo se o estoque já foi consumido depois da
  // compra (produção, perda etc.). Só desfaz se a compra já tinha
  // creditado o estoque (chegou=true) — uma compra ainda não chegada
  // nunca somou nada, não tem o que desfazer.
  const cor = rows[0].cor;
    const gramas = Number(rows[0].gramas);
    if (rows[0].chegou && CORES_FILAMENTO.includes(cor as (typeof CORES_FILAMENTO)[number]) && gramas > 0) {
          await sql`
                UPDATE estoque_filamento
                      SET quantidade_gramas = GREATEST(0, quantidade_gramas - ${gramas}), atualizado_em = now()
                            WHERE cor = ${cor}
                                `;
    }

  return NextResponse.json({ ok: true });
}
