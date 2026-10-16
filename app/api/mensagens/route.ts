import { NextResponse } from "next/server";
import { listarML, listarShopee } from "@/lib/mensagens";

export const dynamic = "force-dynamic";

// GET /api/mensagens -> conversas de ML (perguntas + pos-venda) e Shopee (chat)
export async function GET() {
  const [ml, shopee] = await Promise.all([
    listarML().catch((e) => ({ conectado: true, erro: String(e), conversas: [] })),
    listarShopee().catch((e) => ({ conectado: true, erro: String(e), conversas: [] })),
  ]);
  return NextResponse.json({ ml, shopee });
}
