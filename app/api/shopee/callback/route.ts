import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/shopee";

// Recebe "code" + "shop_id" que a Shopee manda depois do usuário
// autorizar o app, troca por access_token/refresh_token, e guarda tudo em
// cookies httpOnly (não acessíveis via JavaScript no navegador) — mesmo
// padrão usado no /api/mercadolivre/callback.
//
// IMPORTANTE: o access_token da Shopee dura só 4h (bem menos que o da
// ML) — mas o refresh_token salvo aqui embaixo dura 30 dias, e é usado
// por getValidShopeeAccessToken() (lib/shopee-orders.ts) pra renovar o
// access_token sozinho quando ele expira, sem passar por essa tela de
// novo.
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

    const response = NextResponse.redirect(
      new URL("/vendas?plataforma=shopee", req.url)
    );
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    };

    response.cookies.set("shopee_access_token", token.access_token, {
      ...cookieOptions,
      maxAge: token.expire_in,
    });

    response.cookies.set("shopee_refresh_token", token.refresh_token, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    });

    response.cookies.set("shopee_shop_id", String(shopId), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[Shopee callback] falha na troca de token:", message);
    return NextResponse.redirect(
      new URL(`/vendas?plataforma=shopee&erro=token_falhou`, req.url)
    );
  }
}
