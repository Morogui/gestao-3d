import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { getConfigCliente, atualizarConfigCliente } from "@/lib/client-precificacao";

export const dynamic = "force-dynamic";

// Configuracao geral de precificacao do cliente externo (imposto, %Ads
// ML/Shopee, %afiliado Shopee, embalagem, margem desejada) -- os
// mesmos campos de lib/precificacao.ts (ConfigPrecificacao), so que
// persistidos por client_id em vez de globais como no Morolar.
export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const config = await getConfigCliente(sessao.clientId);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const config = await atualizarConfigCliente(sessao.clientId, body);
  return NextResponse.json({ config });
}
