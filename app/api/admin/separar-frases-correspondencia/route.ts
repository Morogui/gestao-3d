import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-07-26) - corrige o problema apontado
// pelo Guilherme com um screenshot da aba Estoque: "SUPORTE UNIVERSAL
// BRANCO" estava aparecendo junto com o texto bruto do anuncio
// ("Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"),
// porque sku_ou_kit servia DOIS papeis ao mesmo tempo - texto exibido
// (convencao de 2026-07-23) e corpo de frases alternativas de casamento
// (convencao usada desde antes dessa sessao, ver placas 13/27/35/44 que
// ja tinham esse padrao). O diagnostico (/api/admin/diagnostico-sku-poluido)
// encontrou 15 placas afetadas, nao so as que essa sessao mexeu.
//
// Migracao: adiciona a coluna frases_correspondencia (so usada por
// textoCorresponde() em lib/demanda.ts, nunca exibida em tela nenhuma).
// Correcao de dados: para toda placa com "|" em sku_ou_kit, o PRIMEIRO
// segmento (antes do primeiro "|") sempre foi o texto real/limpo (e' como
// cada frase foi adicionada nessa e em sessoes anteriores - sempre
// concatenando "frase_original | frase_nova"), entao vira o novo
// sku_ou_kit; os segmentos restantes viram frases_correspondencia
// (juntos com " | " se houver mais de um). Idempotente: só mexe em
// placas que ainda tem "|" em sku_ou_kit.
export async function POST() {
    await sql`
        ALTER TABLE placas ADD COLUMN IF NOT EXISTS frases_correspondencia TEXT
          `;

  const rows = (await sql`
      SELECT id, sku_ou_kit, frases_correspondencia
          FROM placas
              WHERE sku_ou_kit LIKE '%|%'
                  ORDER BY id
                    `) as { id: number; sku_ou_kit: string; frases_correspondencia: string | null }[];

  const atualizados: {
        id: number;
        skuAntes: string;
        skuDepois: string;
        frasesDepois: string;
  }[] = [];

  for (const row of rows) {
        const partes = row.sku_ou_kit
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean);
        if (partes.length === 0) continue;

      const novoSku = partes[0];
        const frasesExtras = partes.slice(1);

      const frasesExistentes = row.frases_correspondencia
          ? row.frases_correspondencia
                  .split("|")
                  .map((f) => f.trim())
                  .filter(Boolean)
              : [];
        const todasAsFrases = [...frasesExistentes, ...frasesExtras];
        const semDuplicata = [...new Set(todasAsFrases.map((f) => f.toLowerCase()))].map(
                (lower) => todasAsFrases.find((f) => f.toLowerCase() === lower)!
              );
        const novasFrases = semDuplicata.join(" | ");

      await sql`
            UPDATE placas
                  SET sku_ou_kit = ${novoSku}, frases_correspondencia = ${novasFrases}
                        WHERE id = ${row.id}
                            `;

      atualizados.push({
              id: row.id,
              skuAntes: row.sku_ou_kit,
              skuDepois: novoSku,
              frasesDepois: novasFrases,
      });
  }

  return NextResponse.json({ ok: true, total: atualizados.length, atualizados });
}
