import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lista TODOS os lançamentos que têm um comprovante anexado, de
// qualquer mês — pedido do Guilherme em 2026-07-27: "um banco de dados
// que salve os comprovantes, onde eu consiga clicar em comprovantes e
// abra a aba com todos comprovantes salvos e a descrição de cada
// comprovante". Só metadados aqui (não traz o arquivo em base64, que é
// pesado) — o arquivo em si é buscado sob demanda em
// /api/financeiro/lancamentos/[id]/arquivo quando o usuário clica pra
// abrir um item específico.
interface Row {
  id: number;
  tipo: string;
  categoria: string;
  descricao: string;
  valor: string;
  data_vencimento: string;
  fornecedor: string | null;
  arquivo_nome: string;
  arquivo_mime: string;
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

export async function GET() {
  const rows = (await sql`
    SELECT id, tipo, categoria, descricao, valor, data_vencimento, fornecedor, arquivo_nome, arquivo_mime, criado_em
    FROM financeiro_lancamentos
    WHERE arquivo_nome IS NOT NULL
    ORDER BY data_vencimento DESC, id DESC
  `) as Row[];

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      categoria: r.categoria,
      descricao: r.descricao,
      valor: Number(r.valor),
      dataVencimento: toPlainDate(r.data_vencimento),
      fornecedor: r.fornecedor,
      arquivoNome: r.arquivo_nome,
      arquivoMime: r.arquivo_mime,
    }))
  );
}
