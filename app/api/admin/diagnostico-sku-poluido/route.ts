import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de diagnostico SOMENTE LEITURA (2026-07-26) - lista placas cujo
// sku_ou_kit contem "|" (frases alternativas de casamento poluindo o
// texto exibido na aba Estoque). So leitura, pra medir o tamanho do
// problema antes de decidir a correcao.
export async function GET() {
    const rows = (await sql`
        SELECT id, numero, nome, sku_ou_kit
            FROM placas
                WHERE sku_ou_kit LIKE '%|%'
                    ORDER BY id
                      `) as { id: number; numero: number; nome: string; sku_ou_kit: string }[];

  return NextResponse.json({ total: rows.length, placas: rows });
}
