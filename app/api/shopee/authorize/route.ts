import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/shopee";

// Inicia o fluxo OAuth: manda o usuário pra tela de login/autorização da
// Shopee. Depois de escolher a loja e autorizar, a Shopee redireciona de
// volta pro /api/shopee/callback com "code" e "shop_id" na URL.
export async function GET() {
  try {
    const url = buildAuthorizationUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
