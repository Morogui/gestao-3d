import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-31). Pedido do Guilherme depois de eu
// ter criado "Suporte BMW - Mista" (84/85) do lado da "Suporte BMW -
// Corpos" (28/64) já existente: "Na hora de colocar para imprimir ele
// está como BMW Corpo - Mas não tenho placa somente com corpo, tem que
// estar mista. já que compõe 3 corpo e 2 gancho na placa" — ou seja, ao
// contrário do que eu assumi (espelhando o Universal, que tem Corpos-só E
// Mista como duas placas físicas reais), o BMW NUNCA teve uma placa
// física só de corpo — a ÚNICA placa que existe de verdade pro corpo do
// BMW é a Mista (imprime corpo+gancho juntos). "Suporte BMW - Corpos"
// (28/64) nunca deveria ter sido o alvo de venda/Full pro corpo do BMW.
//
// Duas correções:
// 1. Repontar sku_placa: "SUPORTE BMW BRANCO"/"PRETO" apontavam pro
//    componente corpo em 28/64 — passam a apontar pra Mista (84/85), que
//    é a placa que realmente é impressa e cuja peça de corpo entra em
//    estoque de verdade. O componente gancho (aponta pro pool
//    compartilhado 82/83) não muda.
// 2. Marca 28/64 como descontinuada — não existe placa física pra
//    produzir, então não deve aparecer como sugestão de produção nem
//    acumular demanda (calcularDemandaSemanal já zera aProduzir de
//    placas descontinuadas). Estoque delas já está em 0 (confirmado antes
//    de rodar isso), então não há nada pra transferir.
//
// Idempotente: só repponta se ainda apontar pra 28/64; só descontinua se
// ainda não estiver descontinuada.
export async function POST() {
  const repontagens: { sku: string; de: number; para: number }[] = [];
  const jaRepontado: { sku: string; para: number }[] = [];

  const REPONTAR = [
    { sku: "SUPORTE BMW BRANCO", deId: 28, paraId: 84 },
    { sku: "SUPORTE BMW PRETO", deId: 64, paraId: 85 },
  ];

  for (const r of REPONTAR) {
    const existenteNoAlvo = (await sql`
      SELECT 1 FROM sku_placa WHERE sku = ${r.sku} AND placa_id = ${r.paraId}
    `) as unknown[];
    if (existenteNoAlvo.length > 0) {
      jaRepontado.push({ sku: r.sku, para: r.paraId });
      continue;
    }
    const rows = await sql`
      UPDATE sku_placa SET placa_id = ${r.paraId}
      WHERE sku = ${r.sku} AND placa_id = ${r.deId}
      RETURNING id
    `;
    if (rows.length > 0) {
      repontagens.push({ sku: r.sku, de: r.deId, para: r.paraId });
    }
  }

  // Confirma que 28/64 estão mesmo zeradas antes de descontinuar — guarda
  // de segurança pra não descontinuar silenciosamente uma placa com
  // estoque real parado.
  const estoqueRows = (await sql`
    SELECT placa_id, COALESCE(quantidade_pecas, 0) AS quantidade_pecas
    FROM estoque_placas WHERE placa_id IN (28, 64)
  `) as { placa_id: number; quantidade_pecas: number }[];
  const estoqueMap = new Map(estoqueRows.map((r) => [r.placa_id, Number(r.quantidade_pecas)]));
  const comEstoque = [28, 64].filter((id) => (estoqueMap.get(id) ?? 0) > 0);
  if (comEstoque.length > 0) {
    return NextResponse.json(
      {
        error: `Placa(s) ${comEstoque.join(", ")} têm estoque > 0 — abortando a descontinuação por segurança (o repontamento do sku_placa acima já rodou).`,
        repontagens,
        jaRepontado,
      },
      { status: 409 }
    );
  }

  const descontinuadas = (await sql`
    UPDATE placas SET descontinuada = true
    WHERE id IN (28, 64) AND descontinuada = false
    RETURNING id, nome
  `) as { id: number; nome: string }[];

  return NextResponse.json({ ok: true, repontagens, jaRepontado, descontinuadas });
}
