import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-28) — o Guilherme confirmou, olhando
// o anúncio real na ML (MLB6716527174, SKU "6X3 21 FATIAS C..."), que
// "Marcador De Fatia Para Bolo Cortador Divisor Confeitaria 21" é a
// placa "6X3 21 FATIAS". O título do anúncio não bate por palavras
// (nenhuma palavra significativa em comum com "6X3 21 FATIAS" além do
// número solto "21", que sozinho não é confiável — ver guarda de
// especificidade em textoCorresponde/lib/demanda.ts) nem por SKU (o
// pedido antigo aparentemente não tinha o SKU customizado salvo no
// snapshot). Mesmo padrão de frases_correspondencia já usado em
// /api/admin/corrigir-alt-frase-box-mm — adiciona o título literal do
// anúncio como frase alternativa, específica só dessa placa (não usa só
// "21" solto, pra não cruzar com "6X2 21 FATIAS"/"6X2.5 21 FATIAS").
export async function POST() {
  const nomePlaca = "6X3 21 FATIAS";
  const fraseNova = "Marcador De Fatia Para Bolo Cortador Divisor Confeitaria 21";

  const rows = (await sql`
    SELECT id, frases_correspondencia FROM placas WHERE nome = ${nomePlaca}
  `) as { id: number; frases_correspondencia: string | null }[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, motivo: "placa não encontrada", nomePlaca });
  }

  const existentes = rows[0].frases_correspondencia
    ? rows[0].frases_correspondencia
        .split("|")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  if (existentes.some((f) => f.toLowerCase() === fraseNova.toLowerCase())) {
    return NextResponse.json({ ok: true, motivo: "já existia", frasesFinal: existentes });
  }

  const todas = [...existentes, fraseNova];
  await sql`
    UPDATE placas SET frases_correspondencia = ${todas.join(" | ")} WHERE id = ${rows[0].id}
  `;

  return NextResponse.json({ ok: true, motivo: "adicionada", frasesFinal: todas });
}
