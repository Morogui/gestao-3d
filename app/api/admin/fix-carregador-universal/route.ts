import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-26) — segunda tentativa, agora
// confirmada com o Guilherme: o anúncio real "Suporte De Parede
// Carregador Carro Elétrico Tipo 2 Universal Branco" NÃO é o produto
// "Suporte Carro" (ver .../revert-carro-universal, que desfez o erro
// anterior) — é a placa "Suporte Universal (corpo/gancho)" [#4/#5
// Branco, #51/#52 Preto]. Adiciona a frase alternativa só nas placas
// Brancas (o anúncio confirmado é Branco); o guard de cor em
// lib/demanda.ts já impede isso de vazar pro Preto.
const PLACA_IDS = [4, 5];
const FRASE = "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal";

function normalizeLower(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function POST() {
  const rows = (await sql`
    SELECT id, sku_ou_kit FROM placas WHERE id = ANY(${PLACA_IDS})
  `) as { id: number; sku_ou_kit: string }[];

  const atualizados: { id: number; antes: string; depois: string }[] = [];
  const fraseAlvo = normalizeLower(FRASE);

  for (const row of rows) {
    const jaPresente = row.sku_ou_kit
      .split("|")
      .some((f) => normalizeLower(f.trim()) === fraseAlvo);
    if (jaPresente) continue;
    const novoValor = `${row.sku_ou_kit} | ${FRASE}`;
    await sql`UPDATE placas SET sku_ou_kit = ${novoValor} WHERE id = ${row.id}`;
    atualizados.push({ id: row.id, antes: row.sku_ou_kit, depois: novoValor });
  }

  return NextResponse.json({ ok: true, atualizados });
}
