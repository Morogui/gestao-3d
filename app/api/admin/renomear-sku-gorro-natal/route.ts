import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

const OLD_SKU = "SKU GORRO DE NATAL";
const NEW_SKU = "GORRO DE NATAL 15CM";

export async function POST() {
  try {
    const existingOld = await sql`
      SELECT COUNT(*)::int AS count FROM sku_placa WHERE sku = ${OLD_SKU}
    `;
    const existingNew = await sql`
      SELECT COUNT(*)::int AS count FROM sku_placa WHERE sku = ${NEW_SKU}
    `;

    if (existingOld[0].count === 0 && existingNew[0].count > 0) {
      return NextResponse.json({
        ok: true,
        message: "Ja renomeado anteriormente, nada a fazer.",
        registros: existingNew[0].count,
      });
    }

    await sql`
      UPDATE sku_placa SET sku = ${NEW_SKU} WHERE sku = ${OLD_SKU}
    `;

    const confirm = await sql`
      SELECT COUNT(*)::int AS count FROM sku_placa WHERE sku = ${NEW_SKU}
    `;

    return NextResponse.json({
      ok: true,
      message: "SKU renomeado com sucesso.",
      de: OLD_SKU,
      para: NEW_SKU,
      registrosAtualizados: confirm[0].count,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
