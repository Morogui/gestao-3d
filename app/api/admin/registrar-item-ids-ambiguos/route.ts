import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAPEAMENTOS: { itemId: string; placaId: number; titulo: string }[] = [
  { itemId: "MLB6841541284", placaId: 49, titulo: "Secador Preto base sem parafuso" },
  { itemId: "MLB7025542046", placaId: 59, titulo: "Kit Box 8mm Kit 2 Preto" },
  { itemId: "MLB6841541452", placaId: 32, titulo: "6 Ou 8 Pratos - 6 Pratos Branco" },
  { itemId: "MLB7025542050", placaId: 17, titulo: "Kit Box 8mm Kit 3 Branco" },
  { itemId: "MLB6841541456", placaId: 68, titulo: "6 Ou 8 Pratos - 6 Pratos Preto" },
  { itemId: "MLB6841541454", placaId: 67, titulo: "6 Ou 8 Pratos - 6 Pratos Marrom" },
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
