import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/shopee";

// Sem isso, o Next.js trata essa rota (GET puro, sem cookies()/request)
// como estática e congela o redirect (com o timestamp/sign calculados
// uma única vez no build) — foi exatamente isso que causava "Invalid
// timestamp" da Shopee: o timestamp ficava travado na data do deploy em
// vez de ser gerado de novo a cada clique em "Conectar com Shopee".
export const dynamic = "force-dynamic";

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
