import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/mercadolivre";
import { salvarTokensML } from "@/lib/ml-auth";
import { salvarTokensClienteML } from "@/lib/client-ml-auth";

// Recebe o "code" que a ML manda depois do usuario autorizar o app, troca
// por access_token/refresh_token, e grava tudo via salvarTokensML (banco
// + cookie -- ver lib/ml-auth.ts). Antes gravava so em cookie httpOnly,
// que a chamada do cron (servidor-a-servidor, sem cookie do navegador)
// nunca conseguia enxergar -- por isso a sincronizacao so rodava de
// verdade quando alguem abria uma aba do app. Pedido do Guilherme em
// 2026-08-14: "nao pode travar por conta da api".
//
// Estendido em 2026-09-14 pra suportar clientes externos (multi-tenant):
// quando o "state" devolvido pela ML comeca com "cliente:<slug>" (ver
// authorize/route.ts), o token pertence a conta ML PROPRIA daquele
// cliente e vai pra tabela separada client_ml_auth (lib/client-ml-auth.ts),
// nunca pra ml_auth (que e exclusiva da Morolar).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const errorParam = req.nextUrl.searchParams.get("error");
  const state = req.nextUrl.searchParams.get("state");
  const clienteMatch = state?.match(/^cliente:(.+)$/);
  const clienteSlug = clienteMatch ? clienteMatch[1] : null;

  if (errorParam || !code) {
    const destino = clienteSlug ? `/${clienteSlug}/vendas` : "/vendas";
    return NextResponse.redirect(
      new URL(`${destino}?erro=${errorParam ?? "sem_code"}`, req.url)
    );
  }

  try {
    const token = await exchangeCodeForToken(code);

    if (clienteSlug) {
      await salvarTokensClienteML(clienteSlug, token);
      return NextResponse.redirect(new URL(`/${clienteSlug}/vendas`, req.url));
    }

    // Grava no banco (fonte de verdade, funciona sem cookie/sessao de
    // navegador -- ver lib/ml-auth.ts) e tambem no cookie, de brinde.
    await salvarTokensML(token);

    return NextResponse.redirect(new URL("/vendas", req.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[ML callback] falha na troca de token:", message);
    const destino = clienteSlug ? `/${clienteSlug}/vendas` : "/vendas";
    return NextResponse.redirect(
      new URL(`${destino}?erro=token_falhou`, req.url)
    );
  }
}
