import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { listarProdutosCliente, criarProdutoCliente } from "@/lib/client-precificacao";

export const dynamic = "force-dynamic";

// Catalogo de produtos (SKU/nome/custo/peso) do cliente externo. Pedido
// do Guilherme em 2026-09-15: replicar a aba Produtos do Morolar pro
// cliente Garimpo. Lista/cria produtos escopados por client_id.
export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const produtos = await listarProdutosCliente(sessao.clientId);
  return NextResponse.json({ produtos });
}

export async function POST(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const { sku, nome, custoProducao, pesoEnvioKg } = body as {
    sku?: string;
    nome?: string;
    custoProducao?: number;
    pesoEnvioKg?: number;
  };
  if (!sku || !sku.trim() || !nome || !nome.trim()) {
    return NextResponse.json({ error: "SKU e nome são obrigatórios" }, { status: 400 });
  }
  const produto = await criarProdutoCliente(sessao.clientId, {
    sku: sku.trim(),
    nome: nome.trim(),
    custoProducao: Number(custoProducao) || 0,
    pesoEnvioKg: Number(pesoEnvioKg) || 0,
  });
  return NextResponse.json({ produto });
}
