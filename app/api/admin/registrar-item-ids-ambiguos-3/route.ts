import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAPEAMENTOS: { itemId: string; placaId: number; titulo: string }[] = [
  { itemId: "MLB6842033064", placaId: 53, titulo: "Kit Box 6mm Kit 3 Preto (confirmado via SKU 3 SUPORTE BOX 6MM PRETO)" },
  { itemId: "MLB6842670364", placaId: 58, titulo: "Par Cortina Com Parafuso Preto (confirmado via SKU PAR DE GANCHOS CORTINA COM PARAFUSO PRETO)" },
  { itemId: "MLB6842670366", placaId: 58, titulo: "Par Cortina Sem Parafuso Preto (confirmado via SKU PAR DE GANCHOS CORTINA SEM PARAFUSO PRETO)" },
  ];

export async function GET() {
  const resultados: { itemId: string; placaId: number; titulo: string; status: string }[] = [];
  for (const m of MAPEAMENTOS) {
    const jaExiste = (await sql`SELECT 1 FROM sku_placa WHERE sku = ${m.itemId} AND placa_id = ${m.placaId}`) as unknown[];
    if (jaExiste.length > 0) {
      resultados.push({ ...m, status: "ja existia" });
      continue;
    }
    await sql`INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade) VALUES (${m.itemId}, ${m.placaId}, 1)`;
    resultados.push({ ...m, status: "inserido" });
  }
  return NextResponse.json({ resultados });
}
