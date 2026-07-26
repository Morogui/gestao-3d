import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-07-26). O Guilherme confirmou que o
// anuncio "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal
// Preto" (62 vendas no periodo, 16 no Full, aparecia como nao
// identificado) tem SKU "Suporte Universal" e e' a MESMA peca das placas
// 51/52 (Suporte Universal Preto - Corpos/Ganchos) - nao e' um produto
// novo. Adiciona esse titulo como frase de correspondencia extra nas
// placas 51 e 52, no mesmo padrao ja usado pro Branco (placas 4/5).
// Idempotente: so adiciona se a frase ainda nao estiver la.
const PLACA_IDS = [51, 52];
const FRASE_NOVA = "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal Preto";

export async function POST() {
    const atualizados: { id: number; frasesAntes: string | null; frasesDepois: string }[] = [];

  for (const id of PLACA_IDS) {
        const rows = (await sql`
              SELECT id, frases_correspondencia FROM placas WHERE id = ${id}
                  `) as { id: number; frases_correspondencia: string | null }[];
        if (rows.length === 0) continue;

      const atual = rows[0].frases_correspondencia;
        const existentes = atual
          ? atual.split("|").map((f) => f.trim()).filter(Boolean)
                : [];

      const jaTem = existentes.some(
              (f) => f.toLowerCase() === FRASE_NOVA.toLowerCase()
            );
        const novasFrases = jaTem
          ? existentes.join(" | ")
                : [...existentes, FRASE_NOVA].join(" | ");

      await sql`
            UPDATE placas SET frases_correspondencia = ${novasFrases} WHERE id = ${id}
                `;

      atualizados.push({ id, frasesAntes: atual, frasesDepois: novasFrases });
  }

  return NextResponse.json({ ok: true, atualizados });
}
