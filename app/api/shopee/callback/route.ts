import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/shopee";
import { salvarTokensShopee } from "@/lib/shopee-auth";

// Recebe "code" + "shop_id" que a Shopee manda depois do usuário
// autorizar o app, troca por access_token/refresh_token, e agora grava
// tudo na tabela shopee_auth do banco (não só em cookie) — ver
// comentário em lib/shopee-auth.ts sobre a causa raiz do "Shopee caindo
// toda hora" (2026-08-26): o cron de 1 em 1 minuto (vercel.json) roda
// sem NENHUM cookie de navegador por trás, então um token guardado só
// em cookie httpOnly nunca era visto por ele — só funcionava enquanto
// alguém tinha o navegador aberto com o cookie ainda vivo (o
// access_token da Shopee dura só 4h). Agora o banco é a fonte de
// verdade, acessível de qualquer contexto; o cookie continua sendo
// gravado só como reforço best-effort (ver salvarTokensShopee).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const shopIdParam = req.nextUrl.searchParams.get("shop_id");

  if (!code || !shopIdParam) {
    return NextResponse.redirect(
      new URL(`/vendas?plataforma=shopee&erro=sem_code`, req.url)
    );
  }

  const shopId = Number(shopIdParam);

  try {
    const token = await exchangeCodeForToken(code, shopId);
    await salvarTokensShopee(token, shopId);

    return NextResponse.redirect(
      new URL("/vendas?plataforma=shopee", req.url)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[Shopee callback] falha na troca de token:", message);
    return NextResponse.redirect(
      new URL(`/vendas?plataforma=shopee&erro=token_falhou`, req.url)
    );
  }
}
