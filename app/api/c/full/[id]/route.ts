import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { atualizarEnvioCliente, excluirEnvioCliente } from "@/lib/client-full";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const { sku, nomeProduto, quantidade, dataPlanejada, status } = (body || {}) as {
    sku: string;
    nomeProduto: string;
    quantidade: number;
    dataPlanejada: string | null;
    status: string;
  };
  const ok = await atualizarEnvioCliente(
    sessao.clientId,
    id,
    sku,
    nomeProduto,
    quantidade,
    dataPlanejada,
    status
  );
  if (!ok) {
    return NextResponse.json({ error: "Envio nao encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id invalido" }, { status: 400 });
  }
  const ok = await excluirEnvioCliente(sessao.clientId, id);
  if (!ok) {
    return NextResponse.json({ error: "Envio nao encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
