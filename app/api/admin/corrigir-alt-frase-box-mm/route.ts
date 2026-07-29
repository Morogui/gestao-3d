import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-28) — pedido do Guilherme: "Os box
// 6mmn na plataforma esta como 6m e 8m, faltou o mm" (os anúncios reais
// na ML têm o título "Kit Ganchos Para Box De Vidro 6m/8m Porta Toalha
// Sem Furo Kit 3", sem o segundo "m" de "mm"), enquanto o catálogo tem
// as placas "Suporte Box 6mm/8mm (kit 1/2/3)" — o "mm" a mais faz
// textoCorresponde() falhar na comparação por substring/palavras
// (ver banner "não bateram com nenhuma placa" na aba Produção). Mesmo
// padrão de frases_correspondencia já usado em várias outras placas
// (ver /api/admin/separar-frases-correspondencia) — adiciona o título
// real do anúncio como frase alternativa, sem mexer no nome exibido.
// Idempotente: só adiciona a frase se ainda não estiver lá.
async function adicionarFrase(nomePlaca: string, fraseNova: string) {
  const rows = (await sql`
    SELECT id, frases_correspondencia FROM placas WHERE nome = ${nomePlaca}
  `) as { id: number; frases_correspondencia: string | null }[];

  if (rows.length === 0) {
    return { nomePlaca, ok: false, motivo: "placa não encontrada" };
  }

  const existentes = rows[0].frases_correspondencia
    ? rows[0].frases_correspondencia
        .split("|")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  if (existentes.some((f) => f.toLowerCase() === fraseNova.toLowerCase())) {
    return { nomePlaca, ok: true, motivo: "já existia", frasesFinal: existentes };
  }

  const todas = [...existentes, fraseNova];
  await sql`
    UPDATE placas SET frases_correspondencia = ${todas.join(" | ")} WHERE id = ${rows[0].id}
  `;
  return { nomePlaca, ok: true, motivo: "adicionada", frasesFinal: todas };
}

export async function POST() {
  const resultado = await Promise.all([
    adicionarFrase(
      "Suporte Box 6mm (kit 1/2/3) (Branco)",
      "Kit Ganchos Para Box De Vidro 6m Porta Toalha Sem Furo Kit 3"
    ),
    adicionarFrase(
      "Suporte Box 6mm (kit 1/2/3) (Preto)",
      "Kit Ganchos Para Box De Vidro 6m Porta Toalha Sem Furo Kit 3"
    ),
    adicionarFrase(
      "Suporte Box 8mm (kit 1/2/3) (Branco)",
      "Kit Ganchos Para Box De Vidro 8m Porta Toalha Sem Furo Kit 3 Branco"
    ),
  ]);

  return NextResponse.json({ ok: true, resultado });
}
