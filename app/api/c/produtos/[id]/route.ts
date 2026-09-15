import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { atualizarProdutoCliente, excluirProdutoCliente } from "@/lib/client-precificacao";

export const dynamic = "force-dynamic";

// PATCH/DELETE de um produto especifico do cliente externo. Usado tanto
// pela aba Produtos (editar sku/nome/custo/peso) quanto pela aba
// Precificacao (editar preco de venda ML/Shopee), ambas escopadas por
// client_id -- ver app/api/c/produtos/route.ts pro comentario completo.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const ok = await atualizarProdutoCliente(sessao.clientId, id, body);
  if (!ok) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!id) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }
  const ok = await excluirProdutoCliente(sessao.clientId, id);
  if (!ok) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
