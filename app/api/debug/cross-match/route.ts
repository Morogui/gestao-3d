import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { getOrdersRange } from "@/lib/ml-orders";
import { matchItemToPlacaIds, SkuPlacaMap } from "@/lib/demanda";
import { diasAtras, todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

export async function GET() {
  const hoje = todaySP();
  const trintaDiasAtras = diasAtras(hoje, 29);
  const result = await getOrdersRange(trintaDiasAtras, hoje);
  if (!result.connected) return NextResponse.json({ connected: false });
  if (result.error) return NextResponse.json({ connected: true, error: true });
  const placaRows = (await sql`SELECT p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto, p.sku_ou_kit, p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier, p.descontinuada, COALESCE(e.quantidade_pecas, 0) AS estoque FROM placas p LEFT JOIN estoque_placas e ON e.placa_id = p.id WHERE p.descontinuada = false ORDER BY p.numero ASC`) as DbPlacaRow[];
  const placas = placaRows.map(toPlacaRow);
  const skuPlacaRows = (await sql`SELECT sku, placa_id, pecas_por_unidade FROM sku_placa`) as { sku: string; placa_id: number; pecas_por_unidade: string }[];
  const skuPlacaMap: SkuPlacaMap = new Map();
  for (const row of skuPlacaRows) {
    const chave = row.sku.toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").replace(/[^a-z0-9]+/g, " ").trim();
    const lista = skuPlacaMap.get(chave) ?? [];
    lista.push({ placaId: row.placa_id, pecasPorUnidade: Number(row.pecas_por_unidade) });
    skuPlacaMap.set(chave, lista);
  }

const placaNomeById = new Map(placas.map((p) => [p.id, p.nome]));
  const porItemId = new Map<string, { titulo: string; sku: string; hasCustomSku: boolean; placaIds: Set<number> }>();
  for (const order of result.orders) {
    for (const item of order.items) {
      if (!item.itemId || item.itemId === "—") continue;
      const placaIds = matchItemToPlacaIds(item, placas, skuPlacaMap);
      const atual = porItemId.get(item.itemId) ?? { titulo: item.title, sku: item.hasCustomSku ? item.sku : "", hasCustomSku: item.hasCustomSku, placaIds: new Set<number>() };
      for (const id of placaIds) atual.placaIds.add(id);
      porItemId.set(item.itemId, atual);
    }
  }

const ambiguos = Array.from(porItemId.entries()).filter(([, v]) => v.placaIds.size > 1).map(([itemId, v]) => ({ itemId, titulo: v.titulo, sku: v.sku, hasCustomSku: v.hasCustomSku, placas: Array.from(v.placaIds).map((id) => ({ id, nome: placaNomeById.get(id) })) }));
  const semMatch = Array.from(porItemId.entries()).filter(([, v]) => v.placaIds.size === 0).map(([itemId, v]) => ({ itemId, titulo: v.titulo, sku: v.sku }));
  return NextResponse.json({ totalItens: porItemId.size, ambiguos, semMatch });
}
