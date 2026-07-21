import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrdersRange } from "@/lib/ml-orders";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { calcularDemandaSemanal } from "@/lib/demanda";
import { todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

// Demanda semanal (últimos 7 dias, incluindo hoje) por placa, com a
// recomendação de produção por Tier (ver lib/demanda.ts). Usada pela
// aba Produção pra sugerir o que carregar nas máquinas.
export async function GET() {
  const hoje = todaySP();
  const seteDiasAtras = new Date(`${hoje}T12:00:00-03:00`);
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 6);
  const inicio = seteDiasAtras.toISOString().slice(0, 10);

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
  const demandaPorPlaca = calcularDemandaSemanal(result.orders, placas);

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio, fim: hoje },
    totalPedidos: result.orders.length,
    demanda: Array.from(demandaPorPlaca.values()),
  });
}
