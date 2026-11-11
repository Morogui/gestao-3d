import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/mercadolivre";

// Inicia o fluxo OAuth: manda o usuário pra tela de login/autorização do
// Mercado Livre. Depois de autorizar, a ML redireciona de volta pro
// /api/mercadolivre/callback com um "code" na URL.
//
// Suporta tambem o fluxo multi-tenant: quando chamada com ?cliente=<slug>
// (ex: pela aba Vendas de um cliente externo como a Plez Store), o slug
// viaja no parametro "state" do OAuth e volta intacto no callback,
// permitindo autorizar a conta ML PROPRIA daquele cliente sem misturar
// com a conta da Morolar. O middleware.ts ja exige uma client_session
// valida pro slug pedido antes de deixar chegar aqui.
export async function GET(req: NextRequest) {
  try {
    const cliente = req.nextUrl.searchParams.get("cliente");
    // 2026-11-11: ?conta=macanhome conecta uma 2a conta ML (mesmo estoque) sem
    // sobrescrever a conta principal -- ver app/api/mercadolivre/callback.
    const conta = req.nextUrl.searchParams.get("conta");
    const contaValida = conta && /^[a-z0-9_-]{2,30}$/.test(conta) ? conta : null;
    const state = cliente ? "cliente:" + cliente : contaValida ? "conta:" + contaValida : undefined;
    const url = buildAuthorizationUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
