import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/mercadolivre";
import { salvarTokensML } from "@/lib/ml-auth";

// Recebe o "code" que a ML manda depois do usuario autorizar o app, troca
// por access_token/refresh_token, e grava tudo via salvarTokensML (banco
// + cookie -- ver lib/ml-auth.ts). Antes gravava so em cookie httpOnly,
// que a chamada do cron (servidor-a-servidor, sem cookie do navegador)
// nunca conseguia enxergar -- por isso a sincronizacao so rodava de
// verdade quando alguem abria uma aba do app. Pedido do Guilherme em
// 2026-08-14: "nao pode travar por conta da api".
export async function GET(req: NextRequest) {
   const code = req.nextUrl.searchParams.get("code");
  const errorParam = req.nextUrl.searchParams.get("error");

  if (errorParam || !code) {
    return NextResponse.redirect(
      new URL(`/vendas?erro=${errorParam ?? "sem_code"}`, req.url)
    );
  }

  try {
    const token = await exchangeCodeForToken(code);

        // Grava no banco (fonte de verdade, funciona sem cookie/sessao de
        // navegador -- ver lib/ml-auth.ts) e tambem no cookie, de brinde.
        await salvarTokensML(token);

        return NextResponse.redirect(new URL("/vendas", req.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[ML callback] falha na troca de token:", message);
    return NextResponse.redirect(
      new URL(`/vendas?erro=token_falhou`, req.url)
    );
  }
}
