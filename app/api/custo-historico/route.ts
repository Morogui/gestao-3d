import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Historico de custo por produto/SKU - alimentado automaticamente por
// lib/custo-filamento-mensal.ts sempre que o custo medio mensal do
// filamento muda o custo de um produto. Pedido do Guilherme em
// 2026-08-14: "salvar cada sku com mudanca e data, para ter uma dre
// completa". Uma linha por produto por evento de mudanca (nao uma linha
// por mes fixo) - so registra quando o valor de fato muda.
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const produtoId = searchParams.get("produtoId");
    const mes = searchParams.get("mes");
    const limite = Number(searchParams.get("limite") ?? 200);

  const rows = produtoId
      ? await sql`
              SELECT id, produto_id, sku, nome, custo_unitario, custo_filamento_kg, mes_referencia, data, criado_em
                      FROM custo_produto_historico
                              WHERE produto_id = ${Number(produtoId)}
                                      ORDER BY criado_em DESC
                                              LIMIT ${limite}
                                                    `
        : mes
      ? await sql`
              SELECT id, produto_id, sku, nome, custo_unitario, custo_filamento_kg, mes_referencia, data, criado_em
                      FROM custo_produto_historico
                              WHERE mes_referencia = ${mes}
                                      ORDER BY criado_em DESC
                                              LIMIT ${limite}
                                                    `
        : await sql`
                SELECT id, produto_id, sku, nome, custo_unitario, custo_filamento_kg, mes_referencia, data, criado_em
                        FROM custo_produto_historico
                                ORDER BY criado_em DESC
                                        LIMIT ${limite}
                                              `;

  const historico = (rows as any[]).map((r) => ({
        id: r.id,
        produtoId: r.produto_id,
        sku: r.sku,
        nome: r.nome,
        custoUnitario: Number(r.custo_unitario),
        custoFilamentoKg: Number(r.custo_filamento_kg),
        mesReferencia: r.mes_referencia,
        data: String(r.data).slice(0, 10),
        criadoEm: r.criado_em,
  }));

  const mesesRows = (await sql`
      SELECT mes, custo_medio_kg, total_gramas, total_valor, atualizado_em
          FROM custo_filamento_mensal
              ORDER BY mes DESC
                `) as any[];

  const mesesCustoFilamento = mesesRows.map((r) => ({
        mes: r.mes,
        custoMedioKg: Number(r.custo_medio_kg),
        totalGramas: Number(r.total_gramas),
        totalValor: Number(r.total_valor),
        atualizadoEm: r.atualizado_em,
  }));

  return NextResponse.json({ historico, mesesCustoFilamento });
}
