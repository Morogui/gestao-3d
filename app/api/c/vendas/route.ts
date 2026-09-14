import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { clienteMlEstaConectado } from "@/lib/client-ml-auth";
import { buscarPedidosClienteML } from "@/lib/client-ml-orders";

export const dynamic = "force-dynamic";

// Vendas de um cliente externo (multi-tenant). O client_id vem SEMPRE da
// sessao verificada no cookie client_session, nunca de um parametro da
// URL -- assim um cliente nunca consegue ver dados de outro so trocando
// o slug. Pedido do Guilherme em 2026-09-14.
export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const conectado = await clienteMlEstaConectado(sessao.clientId);
  if (!conectado) {
    return NextResponse.json({ conectado: false, pedidos: [] });
  }

  const pedidos = await buscarPedidosClienteML(sessao.clientId);
  return NextResponse.json({ conectado: true, pedidos });
}
