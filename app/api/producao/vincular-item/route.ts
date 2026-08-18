import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Vincula um item de venda (nao identificado pelo casamento automatico)
// a uma placa existente - pedido do Guilherme em 2026-08-18: "tenho
// produto cadastrado na sku com placa e ele nao esta lincado com a
// producao... a vinculacao deve ser de forma automatica atravez da sku
// das plataformas". Grava uma linha em sku_placa usando o identificador
// mais estavel disponivel do item real da venda (itemId da ML tem
// prioridade - ver idPorItemId em lib/demanda.ts, que e checado ANTES
// do SKU no casamento), assim toda venda futura desse mesmo
// anuncio/SKU passa a bater automaticamente, sem depender de texto do
// titulo.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const itemId = String(body.itemId ?? "").trim();
  const sku = String(body.sku ?? "").trim();
  const placaId = Number(body.placaId);

  if (!placaId || !Number.isFinite(placaId)) {
    return NextResponse.json({ error: "Informe a placa." }, { status: 400 });
  }

  const chave = itemId && itemId !== "—" ? itemId : sku;
  if (!chave) {
    return NextResponse.json({ error: "Item sem itemId ou SKU pra vincular." }, { status: 400 });
  }

  await sql`
    INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
    SELECT ${chave}, ${placaId}, 1
    WHERE NOT EXISTS (
      SELECT 1 FROM sku_placa WHERE sku = ${chave} AND placa_id = ${placaId}
    )
  `;

  return NextResponse.json({ ok: true });
}
