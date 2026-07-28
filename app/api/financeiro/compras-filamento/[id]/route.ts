import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

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
  };
}

// Marca uma compra de filamento a prazo como paga (ou volta pra
// pendente) — pedido do Guilherme em 2026-07-27: "Filamento pode ser a
// vista, com prazo para pagamwento entao tem que conseguir coloca o
// prazo". Mesmo padrão do PATCH de financeiro_lancamentos.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  if (body.status !== "pago" && body.status !== "pendente") {
    return NextResponse.json({ error: "status deve ser 'pago' ou 'pendente'" }, { status: 400 });
  }

  const status = body.status as string;
  const dataPagamento =
    status === "pago"
      ? body.dataPagamento
        ? String(body.dataPagamento).trim()
        : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : null;

  const rows = (await sql`
    UPDATE compras_filamento
    SET status = ${status}, data_pagamento = ${dataPagamento}
    WHERE id = ${id}
    RETURNING *
  `) as CompraRow[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });
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

  const rows = await sql`
    DELETE FROM compras_filamento WHERE id = ${id} RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "compra não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
