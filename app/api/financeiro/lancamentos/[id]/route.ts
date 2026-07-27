import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

interface LancamentoRow {
  id: number;
  tipo: string;
  categoria: string;
  descricao: string;
  valor: string;
  data_vencimento: string;
  data_pagamento: string | null;
  status: string;
  fornecedor: string | null;
  arquivo_nome: string | null;
  arquivo_mime: string | null;
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

function serializar(r: LancamentoRow) {
  return {
    id: r.id,
    tipo: r.tipo,
    categoria: r.categoria,
    descricao: r.descricao,
    valor: Number(r.valor),
    dataVencimento: toPlainDate(r.data_vencimento),
    dataPagamento: toPlainDate(r.data_pagamento),
    status: r.status,
    fornecedor: r.fornecedor,
    arquivoNome: r.arquivo_nome,
    arquivoMime: r.arquivo_mime,
    criadoEm: r.criado_em,
  };
}

// Edita um lançamento (marcar pago/pendente, corrigir valor/categoria/
// data/descrição/fornecedor). Todos os campos são opcionais — só atualiza
// o que vier no body.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();

  const categoria = body.categoria !== undefined ? String(body.categoria).trim() : null;
  const descricao = body.descricao !== undefined ? String(body.descricao).trim() : null;
  const valor = body.valor !== undefined ? Number(body.valor) : null;
  const dataVencimento = body.dataVencimento !== undefined ? String(body.dataVencimento).trim() : null;
  const fornecedor = body.fornecedor !== undefined ? String(body.fornecedor).trim() : null;

  if (valor !== null && (!Number.isFinite(valor) || valor <= 0)) {
    return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  }

  // status: 'pago' (com dataPagamento, default hoje) ou 'pendente' (limpa
  // dataPagamento) — só mexe em status/data_pagamento se o body pedir
  // explicitamente; caso contrário usa um UPDATE separado que não toca
  // nessas duas colunas (evita passar `undefined` pro driver do Neon).
  let rows: LancamentoRow[];
  if (body.status === "pago" || body.status === "pendente") {
    const status = body.status as string;
    const dataPagamento =
      status === "pago"
        ? body.dataPagamento
          ? String(body.dataPagamento).trim()
          : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null;

    rows = (await sql`
      UPDATE financeiro_lancamentos
      SET categoria = COALESCE(${categoria}, categoria),
          descricao = COALESCE(${descricao}, descricao),
          valor = COALESCE(${valor}, valor),
          data_vencimento = COALESCE(${dataVencimento}, data_vencimento)::date,
          fornecedor = COALESCE(${fornecedor}, fornecedor),
          status = ${status},
          data_pagamento = ${dataPagamento}
      WHERE id = ${id}
      RETURNING *
    `) as LancamentoRow[];
  } else {
    rows = (await sql`
      UPDATE financeiro_lancamentos
      SET categoria = COALESCE(${categoria}, categoria),
          descricao = COALESCE(${descricao}, descricao),
          valor = COALESCE(${valor}, valor),
          data_vencimento = COALESCE(${dataVencimento}, data_vencimento)::date,
          fornecedor = COALESCE(${fornecedor}, fornecedor)
      WHERE id = ${id}
      RETURNING *
    `) as LancamentoRow[];
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "lançamento não encontrado" }, { status: 404 });
  }

  return NextResponse.json(serializar(rows[0]));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const rows = await sql`
    DELETE FROM financeiro_lancamentos WHERE id = ${id} RETURNING id
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "lançamento não encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
