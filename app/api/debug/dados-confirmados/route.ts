import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de diagnostico temporaria -- pedido do Guilherme em 2026-08-14:
// investigar por que Suporte BMW - Mista e Suporte para Garrafa Coracao
// apareceram com dados_confirmados = true sem ele nunca ter usado o
// popup de resumo pos-producao pra validar peso/tempo/pecas dessas
// placas. Cruza dados_confirmados com o historico real de correcoes
// (correcoes_pecas e correcoes_tempo -- as unicas 2 rotas que de fato
// marcam dados_confirmados = true) pra achar placas "confirmadas" so
// pelo backfill que criou a coluna, nunca por um clique real. Remover
// depois de usar.
export async function GET() {
  try {
    const placasRows = await sql`SELECT id, numero, nome, dados_confirmados FROM placas WHERE descontinuada = false ORDER BY numero ASC`;
    const pecasRows = await sql`SELECT DISTINCT placa_id FROM correcoes_pecas`;
    const tempoRows = await sql`SELECT DISTINCT placa_id FROM correcoes_tempo`;
    const pecasSet = new Set((pecasRows as any[]).map((r) => r.placa_id));
    const tempoSet = new Set((tempoRows as any[]).map((r) => r.placa_id));
    const resultado = (placasRows as any[]).map((p) => ({
      id: p.id,
      numero: p.numero,
      nome: p.nome,
      dadosConfirmados: p.dados_confirmados,
      temCorrecaoPecas: pecasSet.has(p.id),
      temCorrecaoTempo: tempoSet.has(p.id),
    }));
    return NextResponse.json(resultado);
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
      { status: 500 }
    );
  }
}
