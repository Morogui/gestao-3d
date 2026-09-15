import { NextRequest, NextResponse } from "next/server";
import { atualizarCliente, atualizarSenhaCliente } from "@/lib/clients";

export const runtime = "nodejs";

const ABAS_DISPONIVEIS = ["vendas", "full"];

// PATCH /api/admin/clientes/[id] -- edita nome/abas liberadas de um
// cliente ja existente, e opcionalmente reseta a senha (so quando o
// campo "senha" vem preenchido no corpo). Painel master, ver
// app/api/admin/clientes/route.ts pro comentario completo sobre por que
// isso existe e por que so a Morolar (g3d_session) acessa.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const { nome, abasPermitidas, senha } = body as {
    nome?: string;
    abasPermitidas?: string[];
    senha?: string;
  };

  if (!nome) {
    return NextResponse.json({ error: "Nome obrigatorio" }, { status: 400 });
  }
  const abas = Array.isArray(abasPermitidas)
    ? abasPermitidas.filter((a) => ABAS_DISPONIVEIS.includes(a))
    : [];

  const ok = await atualizarCliente(params.id, { nome, abasPermitidas: abas });
  if (!ok) {
    return NextResponse.json({ error: "Cliente nao encontrado" }, { status: 404 });
  }

  if (typeof senha === "string" && senha.trim().length > 0) {
    await atualizarSenhaCliente(params.id, senha.trim());
  }

  return NextResponse.json({ ok: true });
}
