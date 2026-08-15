import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { matchItemToPlacaIds, SkuPlacaMap } from "@/lib/demanda";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const placasRes = await fetch(new URL("/api/placas", request.url));
    const placas = await placasRes.json();

    const skuRows = await sql`SELECT sku, placa_id, pecas_por_unidade FROM sku_placa`;
    const skuPlacaMap: SkuPlacaMap = new Map();
    for (const r of skuRows as any[]) {
      const arr = skuPlacaMap.get(r.sku) || [];
      arr.push({ placaId: r.placa_id, pecasPorUnidade: Number(r.pecas_por_unidade) });
      skuPlacaMap.set(r.sku, arr);
    }

    const pedidos = await sql`
      SELECT id, plataforma, data_criado, itens
      FROM pedidos_cache
      WHERE data_criado >= now() - interval '35 days'
      ORDER BY data_criado DESC
    `;

    const matches: any[] = [];
    for (const p of pedidos as any[]) {
      const itens = Array.isArray(p.itens) ? p.itens : [];
      for (const it of itens) {
        const placaIds = matchItemToPlacaIds(it, placas, skuPlacaMap);
        if (placaIds.includes(86)) {
          matches.push({
            pedidoId: p.id,
            plataforma: p.plataforma,
            dataCriado: p.data_criado,
            title: it.title,
            sku: it.sku,
            itemId: it.itemId,
            quantity: it.quantity,
            hasCustomSku: it.hasCustomSku,
            placaIds,
          });
        }
      }
    }

    return NextResponse.json({
      totalPedidos35dias: (pedidos as any[]).length,
      totalPlacas: placas.length,
      totalMatchesPlaca86: matches.length,
      matches,
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? err), stack: String(err?.stack ?? "") }, { status: 500 });
  }
}
