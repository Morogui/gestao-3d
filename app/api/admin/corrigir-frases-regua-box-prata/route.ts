import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota temporaria (2026-08-19): venda de "Regua Bolo 3x10" e "Suporte
// Box 6mm/8mm Prata" nao estava batendo com o catalogo (ver
// lib/demanda.ts) porque o titulo real do anuncio nao contem as mesmas
// palavras do sku_ou_kit/nome da placa. Preenche frases_correspondencia
// com o titulo exato do anuncio pra essas 3 placas. Remover esta rota
// depois de confirmar que a demanda passou a contar essas vendas.
export async function GET() {
    const atualizacoes: { id: number; frase: string }[] = [
      {
              id: 89,
              frase: "Regua Marcador Fatia Para Bolo Espatula 3cm E 10cm Cortador",
      },
      {
              id: 90,
              frase:
                        "Kit Ganchos Para Box De Vidro 6m Porta Toalha Sem Furo Kit 3 Prata",
      },
      {
              id: 91,
              frase:
                        "Kit Ganchos Para Box De Vidro 8m Porta Toalha Sem Furo Kit 3 Prata",
      },
        ];
  
    const resultados = [];
    for (const item of atualizacoes) {
          const rows = await sql`
                UPDATE placas
                      SET frases_correspondencia = ${item.frase}
                            WHERE id = ${item.id}
                                  RETURNING id, nome, frases_correspondencia
                                      `;
          resultados.push(rows[0] ?? { id: item.id, erro: "placa nao encontrada" });
    }
  
    return NextResponse.json({ ok: true, resultados });
}
est
