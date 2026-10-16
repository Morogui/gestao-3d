import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO_TODAS } from "@/lib/placas";
import { recalcularCustoFilamentoMensal } from "@/lib/custo-filamento-mensal";

export const dynamic = "force-dynamic";

// Histórico de compras de filamento + custo médio ponderado por cor
// (soma do valor pago ÷ soma dos gramas).
async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS compras_filamento (
      id SERIAL PRIMARY KEY,
      cor TEXT NOT NULL,
      gramas NUMERIC NOT NULL,
      valor_pago NUMERIC NOT NULL,
      data_compra DATE NOT NULL,
      fornecedor TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // À vista nasce paga; a prazo nasce pendente com vencimento futuro.
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS data_vencimento DATE`;
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pago'`;
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS data_pagamento DATE`;
  await sql`UPDATE compras_filamento SET data_vencimento = data_compra WHERE data_vencimento IS NULL`;
  await sql`UPDATE compras_filamento SET data_pagamento = data_compra WHERE status = 'pago' AND data_pagamento IS NULL`;

  // Controle de chegada física: DEFAULT true mantém compras antigas como
  // recebidas; só compras novas com checkbox desmarcado nascem chegou=false.
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS chegou BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS data_chegada DATE`;
  // Agrupa várias cores de um mesmo "Salvar pedido".
  await sql`ALTER TABLE compras_filamento ADD COLUMN IF NOT EXISTS pedido_id TEXT`;
  await sql`UPDATE compras_filamento SET data_chegada = data_compra WHERE chegou = true AND data_chegada IS NULL`;
}

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
    dataPagamento: r.data_pagamento ? toPlainDate(r.data_pagamento) : null,
    fornecedor: r.fornecedor,
    criadoEm: r.criado_em,
    chegou: r.chegou,
    dataChegada: toPlainDate(r.data_chegada),
    pedidoId: r.pedido_id,
  };
}

export async function GET() {
  await garantirTabela();

  const rows = (await sql`
    SELECT * FROM compras_filamento ORDER BY data_compra DESC, id DESC
  `) as CompraRow[];

  const compras = rows.map(serializar);

  // Custo médio ponderado por cor (R$/grama); cor sem compra fica fora.
  const porCor = new Map<string, { gramas: number; valor: number }>();
  for (const c of compras) {
    const atual = porCor.get(c.cor) ?? { gramas: 0, valor: 0 };
    atual.gramas += c.gramas;
    atual.valor += c.valorPago;
    porCor.set(c.cor, atual);
  }

  const custoMedioPorCor: Record<string, number> = {};
  for (const cor of CORES_FILAMENTO_TODAS) {
    const dados = porCor.get(cor);
    if (dados && dados.gramas > 0) {
      custoMedioPorCor[cor] = dados.valor / dados.gramas;
    }
  }

  const totalGramas = compras.reduce((s, c) => s + c.gramas, 0);
  const totalValor = compras.reduce((s, c) => s + c.valorPago, 0);
  const custoMedioGeral = totalGramas > 0 ? totalValor / totalGramas : null;

  // Custo médio do MÊS ATUAL (ver lib/custo-filamento-mensal.ts).
  const mesRows = (await sql`
    SELECT mes, custo_medio_kg, atualizado_em FROM custo_filamento_mensal
    ORDER BY mes DESC LIMIT 1
  `) as { mes: string; custo_medio_kg: string; atualizado_em: string }[];
  const custoMedioMesAtual = mesRows.length > 0 ? Number(mesRows[0].custo_medio_kg) : null;
  const mesReferenciaCustoMensal = mesRows.length > 0 ? mesRows[0].mes : null;

  return NextResponse.json({
    compras,
    custoMedioPorCor,
    custoMedioMesAtual,
    mesReferenciaCustoMensal,
    custoMedioGeral,
  });
}

export async function POST(request: NextRequest) {
  await garantirTabela();

  const body = await request.json();
  const cor = String(body.cor ?? "").trim();
  const gramas = Number(body.gramas);
  const valorPago = Number(body.valorPago);
  const dataCompra = String(body.dataCompra ?? "").trim();
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;

  if (!cor || !Number.isFinite(gramas) || gramas <= 0 || !Number.isFinite(valorPago) || valorPago <= 0 || !dataCompra) {
    return NextResponse.json(
      { error: "Informe cor, gramas (> 0), valorPago (> 0) e dataCompra." },
      { status: 400 }
    );
  }

  const aPrazo = body.formaPagamento === "a_prazo";
  const dataVencimento = aPrazo
    ? String(body.dataVencimento ?? "").trim() || dataCompra
    : dataCompra;
  const status = aPrazo ? "pendente" : "pago";
  const dataPagamento = aPrazo ? null : dataCompra;

  // Só soma no estoque agora se o pedido já chegou; senão, só ao
  // confirmar a chegada (PATCH em [id]).
  const chegou = body.chegou === undefined ? true : Boolean(body.chegou);
  const pedidoId = body.pedidoId ? String(body.pedidoId).trim() : null;
  const dataChegada = chegou
    ? String(body.dataChegada ?? "").trim() || dataCompra
    : null;

  const rows = (await sql`
    INSERT INTO compras_filamento
      (cor, gramas, valor_pago, data_compra, fornecedor, data_vencimento, status, data_pagamento, chegou, data_chegada, pedido_id)
    VALUES
      (${cor}, ${gramas}, ${valorPago}, ${dataCompra}, ${fornecedor}, ${dataVencimento}, ${status}, ${dataPagamento}, ${chegou}, ${dataChegada}, ${pedidoId})
    RETURNING *
  `) as CompraRow[];

  if (chegou && CORES_FILAMENTO_TODAS.includes(cor as (typeof CORES_FILAMENTO_TODAS)[number])) {
    await sql`
      INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
      VALUES (${cor}, ${gramas}, now())
      ON CONFLICT (cor) DO UPDATE
      SET quantidade_gramas = estoque_filamento.quantidade_gramas + ${gramas}, atualizado_em = now()
    `;
  }

  // Propaga o custo médio mensal e recalcula o custo dos produtos (só
  // quando o filamento chegou de fato).
  if (chegou) {
    await recalcularCustoFilamentoMensal();
  }

  return NextResponse.json(serializar(rows[0]), { status: 201 });
}
