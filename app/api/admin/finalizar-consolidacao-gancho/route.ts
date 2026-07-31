import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-31). A consolidação de 2026-07-26
// (ver /api/admin/consolidar-gancho-compartilhado) criou a placa "Gancho
// Compartilhado" e tentou aposentar as 6 placas antigas de gancho
// avulso (Universal/BMW/BYD × Branco/Preto), mas deixou passar duas
// coisas:
//
//  1. A tabela sku_placa (mapeamento EXATO usado por resolverBaixaDoPedido,
//     que tem prioridade sobre o casamento por texto) ainda apontava
//     "SUPORTE BMW BRANCO"/"PRETO" e "SUPORTE UNIVERSAL BRANCO"/"PRETO"
//     pras placas ANTIGAS (ids 29/65/5/52), não pro Gancho Compartilhado
//     novo (82 Branco / 83 Preto). Resultado: toda venda desses produtos
//     continuou descontando as placas antigas — invisíveis pra Produção,
//     que só lê /api/placas (filtra descontinuada=false). O pool nunca
//     via essas vendas, e as placas antigas (que deveriam ter ficado
//     zeradas e paradas) continuavam se mexendo. (BYD nunca teve linha em
//     sku_placa pro gancho — cai direto no casamento por texto contra o
//     pool, que já está certo desde a consolidação original.)
//  2. Como as placas antigas continuaram recebendo baixa de venda (e
//     nesse meio tempo algum ajuste manual também), sobraram peças reais
//     "presas" nelas (Universal Branco: 22, Universal Preto: 33, BYD
//     Preto: 5) que o painel de Produção não enxerga.
//
// Pedido do Guilherme em 2026-07-31 (via print do BMW, que já tinha
// zerado os dois lados): "Esse antigo tem que tirar do sistema. Para não
// confundir na hora da produção e na hora de lançar estoque" — confirmou
// depois (pergunta de escopo) que queria os 3 produtos corrigidos, não só
// o BMW.
//
// O que essa rota faz (idempotente — se sku_placa já aponta pro pool,
// pula; se a placa antiga já está em 0, não soma nada):
//  1. Repointa as 4 linhas de sku_placa (BMW/Universal × Branco/Preto)
//     pro Gancho Compartilhado da cor certa.
//  2. Transfere o estoque preso das 3 placas antigas com sobra (5→82:
//     Universal Branco 22; 52→83: Universal Preto 33; 79→83: BYD Preto 5)
//     pro pool, e zera a origem — mesma lógica "não perde peça nenhuma"
//     da consolidação original.
// Depois disso, GET /api/estoque passa a ocultar automaticamente essas 6
// placas antigas (todas ficam em 0 e casam com o filtro "GANCHO ANTIGO %
// + estoque zerado" — ver nota em app/api/estoque/route.ts).
const REPOINT_SKU_PLACA: { sku: string; deId: number; paraId: number }[] = [
  { sku: "SUPORTE BMW BRANCO", deId: 29, paraId: 82 },
  { sku: "SUPORTE BMW PRETO", deId: 65, paraId: 83 },
  { sku: "SUPORTE UNIVERSAL BRANCO", deId: 5, paraId: 82 },
  { sku: "SUPORTE UNIVERSAL PRETO", deId: 52, paraId: 83 },
];

const TRANSFERIR_ESTOQUE: { deId: number; paraId: number; label: string }[] = [
  { deId: 5, paraId: 82, label: "Universal Branco (antigo) → Gancho Compartilhado Branco" },
  { deId: 52, paraId: 83, label: "Universal Preto (antigo) → Gancho Compartilhado Preto" },
  { deId: 79, paraId: 83, label: "BYD Preto (antigo) → Gancho Compartilhado Preto" },
];

export async function POST() {
  try {
    return await executar();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function executar() {
  const repointResultado: unknown[] = [];
  for (const r of REPOINT_SKU_PLACA) {
    const rows = (await sql`
      UPDATE sku_placa
      SET placa_id = ${r.paraId}
      WHERE sku = ${r.sku} AND placa_id = ${r.deId}
      RETURNING sku, placa_id
    `) as { sku: string; placa_id: number }[];
    repointResultado.push({ ...r, atualizado: rows.length > 0, linhas: rows });
  }

  const transferenciaResultado: unknown[] = [];
  for (const t of TRANSFERIR_ESTOQUE) {
    const origemRows = (await sql`
      SELECT quantidade_pecas FROM estoque_placas WHERE placa_id = ${t.deId}
    `) as { quantidade_pecas: number }[];
    const quantidade = Number(origemRows[0]?.quantidade_pecas ?? 0);

    if (quantidade > 0) {
      await sql`
        UPDATE estoque_placas
        SET quantidade_pecas = quantidade_pecas + ${quantidade}, atualizado_em = now()
        WHERE placa_id = ${t.paraId}
      `;
      await sql`
        UPDATE estoque_placas
        SET quantidade_pecas = 0, atualizado_em = now()
        WHERE placa_id = ${t.deId}
      `;
      await sql`
        INSERT INTO ajustes_manuais_estoque (placa_id, delta, resultante)
        VALUES (${t.deId}, ${-quantidade}, 0)
      `;
    }

    transferenciaResultado.push({ ...t, quantidadeTransferida: quantidade });
  }

  return NextResponse.json({ ok: true, repointResultado, transferenciaResultado });
}
