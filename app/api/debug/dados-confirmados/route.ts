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
  const rows = await sql`
    SELECT
      p.id, p.numero, p.nome, p.dados_confirmados,
      EXISTS(SELECT 1 FROM correcoes_pecas cp WHERE cp.placa_id = p.id) AS tem_correcao_pecas,
      EXISTS(SELECT 1 FROM correcoes_tempo ct WHERE ct.placa_id = p.id) AS tem_correcao_tempo
    FROM placas p
    WHERE p.descontinuada = false
    ORDER BY p.numero ASC
  `;
  return NextResponse.json(rows);
}
