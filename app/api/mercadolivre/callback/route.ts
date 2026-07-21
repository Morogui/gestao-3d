import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/mercadolivre";

// Recebe o "code" que a ML manda depois do usuário autorizar o app, troca
// por access_token/refresh_token, e guarda tudo em cookies httpOnly
// (não acessíveis via JavaScript no navegador). Isso é suficiente pra um
// uso de conta única — se um dia o sistema precisar de múltiplos usuários,
// vale migrar isso pra um banco de dados de verdade.
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

    const response = NextResponse.redirect(new URL("/vendas", req.url));
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    };

    // access_token dura poucas horas (expires_in, normalmente 6h)
    response.cookies.set("ml_access_token", token.access_token, {
      ...cookieOptions,
      maxAge: token.expires_in,
    });

    // refresh_token dura bem mais (meses) — usamos pra renovar o acesso
    response.cookies.set("ml_refresh_token", token.refresh_token, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 180,
    });

    response.cookies.set("ml_user_id", String(token.user_id), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 180,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro_desconhecido";
    console.error("[ML callback] falha na troca de token:", message);
    return NextResponse.redirect(
      new URL(`/vendas?erro=token_falhou`, req.url)
    );
  }
}
