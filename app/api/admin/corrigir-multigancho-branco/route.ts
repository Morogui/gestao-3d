import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Corrige troca de correspondência entre "Suporte Multigancho (Branco)"
// e "Ganchos Bonito (Branco)" — pedido do Guilherme em 2026-08-07, ao
// ver na aba Full que o anúncio "Suporte Porta Escova Para Parede
// Cabelo Organizador Banheiro Branco Suporte Branco" estava caindo em
// Ganchos Bonito (Branco). O mesmo padrão de anúncio, na cor Preta, já
// apontava certo pro Suporte Multigancho (Preto) — Guilherme confirmou
// que o anúncio "Porta Escova" é mesmo o Suporte Multigancho, então é a
// versão Branco que estava errada. Move a frase de correspondência pra
// placa certa e limpa a errada (Ganchos Bonito Branco volta a depender
// só de correspondência genérica/SKU, igual já é o caso da versão
// Preta de Ganchos Bonito, que nunca teve frase cadastrada).
export async function POST() {
  const multiganchoBranco = (await sql`
    SELECT id, frases_correspondencia FROM placas WHERE nome = 'Suporte Multigancho (Branco)'
  `) as { id: number; frases_correspondencia: string | null }[];
  const ganchosBonitoBranco = (await sql`
    SELECT id, frases_correspondencia FROM placas WHERE nome = 'Ganchos Bonito (Branco)'
  `) as { id: number; frases_correspondencia: string | null }[];

  if (multiganchoBranco.length === 0) {
    return NextResponse.json({ error: "placa 'Suporte Multigancho (Branco)' não encontrada" }, { status: 404 });
  }
  if (ganchosBonitoBranco.length === 0) {
    return NextResponse.json({ error: "placa 'Ganchos Bonito (Branco)' não encontrada" }, { status: 404 });
  }

  const frase = "Suporte Porta Escova Para Parede Cabelo Organizador Banheiro Branco Suporte Branco";

  await sql`
    UPDATE placas SET frases_correspondencia = ${frase} WHERE id = ${multiganchoBranco[0].id}
  `;
  await sql`
    UPDATE placas SET frases_correspondencia = NULL WHERE id = ${ganchosBonitoBranco[0].id}
  `;

  return NextResponse.json({
    ok: true,
    multiganchoBrancoId: multiganchoBranco[0].id,
    fraseAntigaMultigancho: multiganchoBranco[0].frases_correspondencia,
    fraseNovaMultigancho: frase,
    ganchosBonitoBrancoId: ganchosBonitoBranco[0].id,
    fraseAntigaGanchosBonito: ganchosBonitoBranco[0].frases_correspondencia,
  });
}
