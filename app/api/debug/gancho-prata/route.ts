import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de diagnostico temporaria -- pedido do Guilherme em 2026-08-15:
// por que "Gancho Compartilhado - Universal/BMW/BYD (Prata)" aparece com
// "a produzir: 3" na fila, se nenhum corpo que usa esse gancho (BMW
// Prata) esta na fila e ele diz que esse produto nao teve venda? Mostra
// (1) qualquer sku_placa apontando pra placa 86 (match exato por
// SKU/item_id) e (2) qualquer item de pedido (ultimos 35 dias, ML) cujo
// titulo/sku contenha palavras que batem no casamento por texto da
// placa 86, pra achar a venda real por tras do numero. Remover depois.
export async function GET() {
  try {
    const skuPlacaRows = await sql`
      SELECT sku, placa_id, pecas_por_unidade FROM sku_placa WHERE placa_id = 86
    `;

    const placaRows = await sql`
      SELECT id, nome, sku_ou_kit, frases_correspondencia FROM placas WHERE id = 86
    `;

    const pedidos = await sql`
      SELECT id, plataforma, data_criado, itens
      FROM pedidos_cache
      WHERE plataforma = 'ml' AND data_criado >= now() - interval '35 days'
      ORDER BY data_criado DESC
    `;

    const palavrasChave = ["prata", "bmw", "byd", "universal", "carregador", "gancho compartilhado"];
    const itensSuspeitos: any[] = [];
    for (const p of pedidos as any[]) {
      const itens = Array.isArray(p.itens) ? p.itens : [];
      for (const it of itens) {
        const texto = `${it.title ?? ""} ${it.sku ?? ""}`.toLowerCase();
        if (palavrasChave.some((k) => texto.includes(k))) {
          itensSuspeitos.push({
            pedidoId: p.id,
            dataCriado: p.data_criado,
            title: it.title,
            sku: it.sku,
            itemId: it.itemId,
            quantity: it.quantity,
            hasCustomSku: it.hasCustomSku,
          });
        }
      }
    }

    return NextResponse.json({
      placa86: placaRows[0] ?? null,
      skuPlacaParaPlaca86: skuPlacaRows,
      totalPedidosMl35dias: (pedidos as any[]).length,
      itensSuspeitos,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
      { status: 500 }
    );
  }
}
