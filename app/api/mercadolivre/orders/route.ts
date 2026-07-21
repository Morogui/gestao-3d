import { NextRequest, NextResponse } from "next/server";
import { getOrders } from "@/lib/ml-orders";

// Rota JSON pros pedidos do dia — usada pela aba Produção (Client
// Component) pra cruzar com os produtos cadastrados na aba Custo, que só
// existem no localStorage do navegador (por isso o cruzamento acontece
// no cliente, e não direto no servidor como a aba Vendas).
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const day = request.nextUrl.searchParams.get("data") ?? undefined;
  const result = await getOrders(day);
  return NextResponse.json(result);
}
