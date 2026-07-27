import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lançamentos financeiros (despesas + receitas) — aba Financeiro,
// pedido do Guilherme em 2026-07-27. Guarda o comprovante em base64 na
// própria linha (sem storage externo) — volume baixo (dezenas de
// documentos/mês), simplifica a arquitetura.
async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('despesa', 'receita')),
      categoria TEXT NOT NULL,
      descricao TEXT NOT NULL DEFAULT '',
      valor NUMERIC NOT NULL,
      data_vencimento DATE NOT NULL,
      data_pagamento DATE,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago')),
      fornecedor TEXT,
      arquivo_nome TEXT,
      arquivo_mime TEXT,
      arquivo_base64 TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // forma_pagamento — pedido do Guilherme em 2026-07-27: "a IA separar
  // essa compra por categoria e qual tipo de pagamento" (PIX, boleto,
  // cartão etc.). Coluna adicionada depois da tabela já existir em
  // produção — ADD COLUMN IF NOT EXISTS é idempotente, não quebra se
  // rodar de novo.
  await sql`
    ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS forma_pagamento TEXT
  `;
}

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
  forma_pagamento: string | null;
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
    formaPagamento: r.forma_pagamento,
    arquivoNome: r.arquivo_nome,
    arquivoMime: r.arquivo_mime,
    criadoEm: r.criado_em,
  };
}

// GET ?mes=YYYY-MM (default: mês atual) — retorna os lançamentos do mês
// (filtrando por data_vencimento) + um resumo (totais/saldo/pendentes).
export async function GET(request: NextRequest) {
  await garantirTabela();

  const mes =
    request.nextUrl.searchParams.get("mes") ??
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const inicio = `${mes}-01`;

  const rows = (await sql`
    SELECT * FROM financeiro_lancamentos
    WHERE data_vencimento >= ${inicio}::date
      AND data_vencimento < (${inicio}::date + INTERVAL '1 month')
    ORDER BY data_vencimento ASC, id ASC
  `) as LancamentoRow[];

  const lancamentos = rows.map(serializar);

  let totalDespesas = 0;
  let totalReceitas = 0;
  let despesasPendentes = 0;
  let despesasPendentesValor = 0;

  for (const l of lancamentos) {
    if (l.tipo === "despesa") {
      totalDespesas += l.valor;
      if (l.status === "pendente") {
        despesasPendentes += 1;
        despesasPendentesValor += l.valor;
      }
    } else {
      totalReceitas += l.valor;
    }
  }

  return NextResponse.json({
    mes,
    lancamentos,
    resumo: {
      totalDespesas,
      totalReceitas,
      saldo: totalReceitas - totalDespesas,
      despesasPendentes,
      despesasPendentesValor,
    },
  });
}

// Cria um lançamento novo — manual ou depois da revisão do que a IA
// extraiu de um comprovante (ver /api/financeiro/ler-documento).
export async function POST(request: NextRequest) {
  await garantirTabela();

  const body = await request.json();
  const tipo = String(body.tipo ?? "").trim();
  const categoria = String(body.categoria ?? "").trim();
  const descricao = String(body.descricao ?? "").trim();
  const valor = Number(body.valor);
  const dataVencimento = String(body.dataVencimento ?? "").trim();
  const dataPagamento = body.dataPagamento ? String(body.dataPagamento).trim() : null;
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;
  const formaPagamento = body.formaPagamento ? String(body.formaPagamento).trim() : null;
  const arquivoNome = body.arquivoNome ? String(body.arquivoNome) : null;
  const arquivoMime = body.arquivoMime ? String(body.arquivoMime) : null;
  const arquivoBase64 = body.arquivoBase64 ? String(body.arquivoBase64) : null;
  const status = dataPagamento ? "pago" : "pendente";

  if (tipo !== "despesa" && tipo !== "receita") {
    return NextResponse.json({ error: "tipo precisa ser 'despesa' ou 'receita'." }, { status: 400 });
  }
  if (!categoria || !Number.isFinite(valor) || valor <= 0 || !dataVencimento) {
    return NextResponse.json(
      { error: "Informe categoria, valor (> 0) e dataVencimento." },
      { status: 400 }
    );
  }

  const rows = (await sql`
    INSERT INTO financeiro_lancamentos
      (tipo, categoria, descricao, valor, data_vencimento, data_pagamento, status, fornecedor, forma_pagamento, arquivo_nome, arquivo_mime, arquivo_base64)
    VALUES
      (${tipo}, ${categoria}, ${descricao}, ${valor}, ${dataVencimento}, ${dataPagamento}, ${status}, ${fornecedor}, ${formaPagamento}, ${arquivoNome}, ${arquivoMime}, ${arquivoBase64})
    RETURNING *
  `) as LancamentoRow[];

  return NextResponse.json(serializar(rows[0]), { status: 201 });
}
