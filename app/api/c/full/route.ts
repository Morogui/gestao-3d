import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { listarEnviosCliente, criarEnvioCliente } from "@/lib/client-full";

export const dynamic = "force-dynamic";

// Planejamento Full de um cliente externo (multi-tenant). client_id
// sempre derivado da sessao (cookie client_session), nunca de input do
// cliente -- isolamento de dados entre clientes. Pedido do Guilherme em
// 2026-09-14.
export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }
  const envios = await listarEnviosCliente(sessao.clientId);
  return NextResponse.json({ envios });
}

export async function POST(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { sku, nomeProduto, quantidade, dataPlanejada } = (body || {}) as {
    sku?: string;
    nomeProduto?: string;
    quantidade?: number;
    dataPlanejada?: string | null;
  };
  if (!sku || !nomeProduto || !quantidade) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }
  const envio = await criarEnvioCliente(
    sessao.clientId,
    sku,
    nomeProduto,
    quantidade,
    dataPlanejada ?? null
  );
  return NextResponse.json(envio);
}
