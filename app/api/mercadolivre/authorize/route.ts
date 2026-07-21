import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/mercadolivre";

// Inicia o fluxo OAuth: manda o usuário pra tela de login/autorização do
// Mercado Livre. Depois de autorizar, a ML redireciona de volta pro
// /api/mercadolivre/callback com um "code" na URL.
export async function GET() {
  try {
    const url = buildAuthorizationUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
