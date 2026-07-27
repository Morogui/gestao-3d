import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Histórico de compras de filamento — pedido do Guilherme em
// 2026-07-27: "compramos filamentos em diversas datas e precisamos fazer
// o custo medio do meu filamento, ate pra saber o preco real dos custos
// da empresa pra producao". Cada compra é um lançamento manual (data,
// cor, gramas, valor pago, fornecedor); o custo médio por cor é
// calculado aqui como média PONDERADA (soma do valor pago ÷ soma dos
// gramas), não média simples — compras maiores pesam mais, que é o
// cálculo correto de custo médio de estoque.
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
}

interface CompraRow {
  id: number;
  cor: string;
  gramas: string;
  valor_pago: string;
  data_compra: string;
  fornecedor: string | null;
  criado_em: string;
}

function toPlainDate(v: unknown): string {
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
    fornecedor: r.fornecedor,
    criadoEm: r.criado_em,
  };
}

export async function GET() {
  await garantirTabela();

  const rows = (await sql`
    SELECT * FROM compras_filamento ORDER BY data_compra DESC, id DESC
  `) as CompraRow[];

  const compras = rows.map(serializar);

  // Custo médio ponderado por cor (R$/grama) — só entram compras da cor;
  // cor sem nenhuma compra registrada fica de fora do mapa (o front trata
  // como "sem dado" em vez de mostrar 0).
  const porCor = new Map<string, { gramas: number; valor: number }>();
  for (const c of compras) {
    const atual = porCor.get(c.cor) ?? { gramas: 0, valor: 0 };
    atual.gramas += c.gramas;
    atual.valor += c.valorPago;
    porCor.set(c.cor, atual);
  }

  const custoMedioPorCor: Record<string, number> = {};
  for (const cor of CORES_FILAMENTO) {
    const dados = porCor.get(cor);
    if (dados && dados.gramas > 0) {
      custoMedioPorCor[cor] = dados.valor / dados.gramas;
    }
  }

  const totalGramas = compras.reduce((s, c) => s + c.gramas, 0);
  const totalValor = compras.reduce((s, c) => s + c.valorPago, 0);
  const custoMedioGeral = totalGramas > 0 ? totalValor / totalGramas : null;

  return NextResponse.json({
    compras,
    custoMedioPorCor,
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

  const rows = (await sql`
    INSERT INTO compras_filamento (cor, gramas, valor_pago, data_compra, fornecedor)
    VALUES (${cor}, ${gramas}, ${valorPago}, ${dataCompra}, ${fornecedor})
    RETURNING *
  `) as CompraRow[];

  return NextResponse.json(serializar(rows[0]), { status: 201 });
}
