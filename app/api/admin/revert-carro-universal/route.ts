import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-26) — CORREÇÃO de um erro cometido
// na rota /api/admin/fix-catalogo-full: o anúncio real "Suporte De
// Parede Carregador Carro Elétrico Tipo 2 Universal Branco" tinha sido
// associado às placas #8/#9 "Suporte Carro" (Branco/Cinza/Preto), mas
// o Guilherme confirmou (ao ver "faltam Xpç p/ despachar" aparecer sem
// nenhum pedido real de Suporte Carro) que isso está ERRADO — segundo
// docs/sku-catalogo.md, "Suporte Carro" (#8/#9) é um produto BEM
// diferente do suporte pra carregador de carro elétrico (mesmo molde
// problema já documentado pro #42 "Suporte Carregador BYD": "produto
// distinto do #8/#9 Suporte Carro — molde próprio"). Essa rota remove
// a frase alternativa errada das placas #8, #9, #54, #55, #56, #57
// (todas as cores de "Suporte Carro"), voltando ao sku_ou_kit original.
// A placa CERTA pro anúncio "Carregador Carro Elétrico Tipo 2
// Universal" ainda precisa ser confirmada com o Guilherme antes de
// tentar re-associar.
const PLACA_IDS = [8, 9, 54, 55, 56, 57];
const FRASE_ERRADA = "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal";

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

  const revertidos: { id: number; antes: string; depois: string }[] = [];
  const fraseAlvo = normalizeLower(FRASE_ERRADA);

  for (const row of rows) {
    const partes = row.sku_ou_kit.split("|").map((f) => f.trim());
    const semFraseErrada = partes.filter((p) => normalizeLower(p) !== fraseAlvo);
    const novoValor = semFraseErrada.join(" | ");
    if (novoValor !== row.sku_ou_kit) {
      await sql`UPDATE placas SET sku_ou_kit = ${novoValor} WHERE id = ${row.id}`;
      revertidos.push({ id: row.id, antes: row.sku_ou_kit, depois: novoValor });
    }
  }

  return NextResponse.json({ ok: true, revertidos });
}
