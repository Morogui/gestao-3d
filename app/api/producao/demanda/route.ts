import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrdersRange } from "@/lib/ml-orders";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { calcularDemandaSemanal, SkuPlacaMap } from "@/lib/demanda";
import { todaySP } from "@/lib/date";

// Mesma normalização usada em lib/demanda.ts pra chave do mapa (minúsculo,
// sem acento, sem pontuação) — precisa bater exatamente com a chave usada
// na hora de consultar o mapa lá dentro.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const dynamic = "force-dynamic";

const DIAS_BASE = 30;

// Demanda (base: últimos 30 dias, incluindo hoje) por placa, com meta de
// estoque de "1 semana no ritmo atual + 1 semana de reforço" — ver
// lib/demanda.ts pra detalhes da mudança de fórmula (2026-07-21). Usada
// pela aba Produção pra sugerir o que carregar nas máquinas.
export async function GET() {
  const hoje = todaySP();
  const inicioBaseDate = new Date(`${hoje}T12:00:00-03:00`);
  inicioBaseDate.setDate(inicioBaseDate.getDate() - (DIAS_BASE - 1));
  const inicio = inicioBaseDate.toISOString().slice(0, 10);

  const seteDiasAtrasDate = new Date(`${hoje}T12:00:00-03:00`);
  seteDiasAtrasDate.setDate(seteDiasAtrasDate.getDate() - 6);

  const result = await getOrdersRange(inicio, hoje);

  if (!result.connected) {
    return NextResponse.json({ connected: false });
  }
  if (result.error) {
    return NextResponse.json({ connected: true, error: true });
  }

  const placaRows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    WHERE p.descontinuada = false
    ORDER BY p.numero ASC
  `) as DbPlacaRow[];

  const placas = placaRows.map(toPlacaRow);

  // Catálogo exato SKU → placa (importado da planilha de SKUs reais),
  // usado como 1ª tentativa de casamento venda↔placa antes do fallback
  // por texto (ver lib/demanda.ts).
  const skuPlacaRows = (await sql`
    SELECT sku, placa_id, pecas_por_unidade FROM sku_placa
  `) as { sku: string; placa_id: number; pecas_por_unidade: string }[];

  const skuPlacaMap: SkuPlacaMap = new Map();
  for (const row of skuPlacaRows) {
    const chave = normalize(row.sku);
    const lista = skuPlacaMap.get(chave) ?? [];
    lista.push({
      placaId: row.placa_id,
      pecasPorUnidade: Number(row.pecas_por_unidade),
    });
    skuPlacaMap.set(chave, lista);
  }

  // Base de 30 dias — define o ritmo semanal e a meta de estoque (ver
  // lib/demanda.ts). aProduzir e recomendadoEstoque vêm daqui.
  const demandaBase = calcularDemandaSemanal(
    result.orders,
    placas,
    skuPlacaMap,
    DIAS_BASE
  );

  // Só pra alimentar o "Vendido no Full (semana)" — reaproveita os
  // pedidos já buscados (sem nova chamada à ML), filtrando pros últimos
  // 7 dias. Não altera aProduzir/recomendadoEstoque.
  const orders7d = result.orders.filter(
    (o) => new Date(o.dateCreated) >= seteDiasAtrasDate
  );
  const demandaSemana = calcularDemandaSemanal(orders7d, placas, skuPlacaMap, 7);

  const demandaFinal = placas.map((placa) => {
    const base = demandaBase.get(placa.id)!;
    const semana = demandaSemana.get(placa.id);
    return { ...base, qtyVendidaFull: semana?.qtyVendidaFull ?? 0 };
  });

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio, fim: hoje },
    totalPedidos: result.orders.length,
    demanda: demandaFinal,
  });
}
