import { NextRequest, NextResponse } from "next/server";
import { verificarLogin } from "@/lib/clients";
import { criarClientSessionCookie } from "@/lib/client-session-server";

// Login de cliente externo (multi-tenant, ex: Plez Store em /plez/login).
// Espelha app/api/auth/login/route.ts (login da Morolar), mas grava a
// sessao num cookie SEPARADO (client_session, ver lib/client-session-server.ts)
// pra nunca se misturar com o g3d_session da Morolar. Pedido do
// Guilherme em 2026-09-14.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { clientId, login, senha } = (body || {}) as {
    clientId?: string;
    login?: string;
    senha?: string;
  };

  if (!clientId || !login || !senha) {
    return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
  }

  const cliente = await verificarLogin(clientId, login, senha);
  if (!cliente) {
    return NextResponse.json({ error: "Login ou senha invalidos" }, { status: 401 });
  }

  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 dias
  const token = criarClientSessionCookie({
    clientId: cliente.id,
    abas: cliente.abasPermitidas,
    exp,
  });

  const res = NextResponse.json({ ok: true, abas: cliente.abasPermitidas });
  res.cookies.set("client_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
  return res;
}
