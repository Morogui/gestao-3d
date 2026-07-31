import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-31). Mesma correção já aplicada ao
// BMW (ver /api/admin/corrigir-bmw-so-mista), agora pro Universal —
// pedido do Guilherme, olhando o mesmo problema no "Buscar SKU": "Mesma
// coisa ainda acontece com o universal a placa 1 dele é 3 corpo e 2
// ganchos e a placa 2 somente os ganchos que compartilham com os outros
// SKUS" — ou seja, só existem DUAS placas físicas reais pro Universal
// (Mista = 3 corpo + 2 gancho, e o Gancho Compartilhado), a "Suporte
// Universal - Corpos" (4/51) nunca foi uma placa física separada.
//
// Diferença importante em relação ao BMW: aqui as placas "Corpos" (4/51)
// TÊM estoque real (peças de verdade já produzidas e ainda não vendidas),
// e a "Mista" (80/81) ainda está com a arquitetura ANTIGA/errada (papel
// = 'gancho', crédito próprio = gancho, saída extra = corpo pro Corpos —
// o inverso do que deveria ser, ver nota em app/api/placas/[id]/route.ts
// de 2026-07-31). Por isso essa rota faz TRÊS coisas, nessa ordem:
//
// 1. Transfere o estoque hoje "preso" em cada placa pro lugar certo:
//    - o estoque PRÓPRIO da Mista (marcado como gancho no modelo antigo)
//      vai pro Gancho Compartilhado da cor certa (82/83);
//    - o estoque da Corpos (corpo de verdade) vai pra própria Mista (que
//      depois do PATCH abaixo passa a representar o corpo do grupo).
// 2. Inverte a Mista pro modelo certo (papel='corpo', pecas_por_placa=3,
//    saída extra = 2 pro Gancho Compartilhado) — mesmo padrão já usado
//    pro BMW e pro Suporte Carro.
// 3. Reponta sku_placa (SUPORTE UNIVERSAL BRANCO/PRETO, componente corpo)
//    da Corpos pra Mista, e descontinua a Corpos (só depois de confirmar
//    que seu estoque já zerou com a transferência do passo 1).
//
// Idempotente na medida do possível: se a Mista já estiver com
// papel='corpo' (ou seja, essa rota já rodou), pula os passos 1 e 2 pra
// essa cor e só garante o sku_placa/descontinuação.
const CORPOS_BRANCO = 4;
const CORPOS_PRETO = 51;
const MISTA_BRANCO = 80;
const MISTA_PRETO = 81;
const POOL_BRANCO = 82;
const POOL_PRETO = 83;

async function lerEstoque(placaId: number): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(quantidade_pecas, 0) AS q FROM estoque_placas WHERE placa_id = ${placaId}
  `) as { q: number }[];
  return Number(rows[0]?.q ?? 0);
}

async function transferir(deId: number, paraId: number, motivo: string) {
  const atual = await lerEstoque(deId);
  if (atual <= 0) return { deId, paraId, transferido: 0 };

  await sql`
    INSERT INTO estoque_placas (placa_id, quantidade_pecas)
    VALUES (${paraId}, ${atual})
    ON CONFLICT (placa_id) DO UPDATE
    SET quantidade_pecas = estoque_placas.quantidade_pecas + ${atual}, atualizado_em = now()
  `;
  await sql`
    UPDATE estoque_placas SET quantidade_pecas = 0, atualizado_em = now() WHERE placa_id = ${deId}
  `;
  await sql`
    INSERT INTO ajustes_manuais_estoque (placa_id, delta, resultante)
    VALUES (${deId}, ${-atual}, 0)
  `;
  return { deId, paraId, transferido: atual, motivo };
}

export async function POST() {
  const transferencias: unknown[] = [];

  // Passo 1a — estoque próprio da Mista (gancho, modelo antigo) pro pool.
  const mistaBrancoRows = (await sql`SELECT papel FROM placas WHERE id = ${MISTA_BRANCO}`) as { papel: string }[];
  const mistaPretoRows = (await sql`SELECT papel FROM placas WHERE id = ${MISTA_PRETO}`) as { papel: string }[];
  const brancoAindaAntigo = mistaBrancoRows[0]?.papel === "gancho";
  const pretoAindaAntigo = mistaPretoRows[0]?.papel === "gancho";

  if (brancoAindaAntigo) {
    transferencias.push(await transferir(MISTA_BRANCO, POOL_BRANCO, "gancho da Mista (modelo antigo) → pool"));
  }
  if (pretoAindaAntigo) {
    transferencias.push(await transferir(MISTA_PRETO, POOL_PRETO, "gancho da Mista (modelo antigo) → pool"));
  }

  // Passo 1b — estoque real da Corpos pra própria Mista.
  transferencias.push(await transferir(CORPOS_BRANCO, MISTA_BRANCO, "corpo da Corpos → Mista"));
  transferencias.push(await transferir(CORPOS_PRETO, MISTA_PRETO, "corpo da Corpos → Mista"));

  // Passo 2 — inverte a Mista pro modelo certo (só se ainda não tiver rodado).
  const invertidas: { id: number }[] = [];
  if (brancoAindaAntigo) {
    await sql`
      UPDATE placas
      SET papel = 'corpo', pecas_por_placa = 3,
          saida_extra_placa_id = ${POOL_BRANCO}, saida_extra_pecas = 2
      WHERE id = ${MISTA_BRANCO}
    `;
    invertidas.push({ id: MISTA_BRANCO });
  }
  if (pretoAindaAntigo) {
    await sql`
      UPDATE placas
      SET papel = 'corpo', pecas_por_placa = 3,
          saida_extra_placa_id = ${POOL_PRETO}, saida_extra_pecas = 2
      WHERE id = ${MISTA_PRETO}
    `;
    invertidas.push({ id: MISTA_PRETO });
  }

  // Passo 3 — sku_placa e descontinuação da Corpos.
  const repontagens: { sku: string; de: number; para: number }[] = [];
  const REPONTAR = [
    { sku: "SUPORTE UNIVERSAL BRANCO", deId: CORPOS_BRANCO, paraId: MISTA_BRANCO },
    { sku: "SUPORTE UNIVERSAL PRETO", deId: CORPOS_PRETO, paraId: MISTA_PRETO },
  ];
  for (const r of REPONTAR) {
    const rows = await sql`
      UPDATE sku_placa SET placa_id = ${r.paraId}
      WHERE sku = ${r.sku} AND placa_id = ${r.deId}
      RETURNING id
    `;
    if (rows.length > 0) repontagens.push(r);
  }

  const estoqueCorposBranco = await lerEstoque(CORPOS_BRANCO);
  const estoqueCorposPreto = await lerEstoque(CORPOS_PRETO);
  const comEstoque = [
    estoqueCorposBranco > 0 ? CORPOS_BRANCO : null,
    estoqueCorposPreto > 0 ? CORPOS_PRETO : null,
  ].filter((x): x is number => x !== null);

  if (comEstoque.length > 0) {
    return NextResponse.json(
      {
        error: `Placa(s) ${comEstoque.join(", ")} ainda com estoque > 0 depois da transferência — abortando a descontinuação por segurança.`,
        transferencias,
        invertidas,
        repontagens,
      },
      { status: 409 }
    );
  }

  const descontinuadas = (await sql`
    UPDATE placas SET descontinuada = true
    WHERE id IN (${CORPOS_BRANCO}, ${CORPOS_PRETO}) AND descontinuada = false
    RETURNING id, nome
  `) as { id: number; nome: string }[];

  return NextResponse.json({ ok: true, transferencias, invertidas, repontagens, descontinuadas });
}
