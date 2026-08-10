import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAPEAMENTOS: { itemId: string; placaId: number; titulo: string }[] = [
  { itemId: "MLB6994673398", placaId: 6, titulo: "Kit Box 6mm Kit 3 Branco" },
  { itemId: "MLB6994686382", placaId: 6, titulo: "Kit Box 6mm Kit 2 Branco" },
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
