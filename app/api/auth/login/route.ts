import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verificarLoginGlobal } from "@/lib/clients";
import { criarClientSessionCookie } from "@/lib/client-session-server";

export const runtime = "nodejs";

// Login unificado -- pedido do Guilherme em 2026-09-14: "o login da
// plez ou da morolar, tem que ser feitos por essa janela
// https://www.escala7x7ecommerce.com.br/login". Antes, cada cliente
// externo (ex: Plez Store) tinha sua propria tela em /<slug>/login,
// que chamava uma rota separada (/api/auth/cliente-login) exigindo o
// slug no corpo da requisicao. Isso criava dois problemas: (1) o
// usuario do cliente precisava saber e digitar a URL certa com o
// slug, em vez de so acessar o mesmo /login que a Morolar usa; (2) ao
// revisar o middleware pra fazer essa mudanca, foi encontrado que
// /api/auth/cliente-login nao estava na lista de rotas publicas --
// ou seja, um cliente de verdade (sem sessao Morolar no navegador)
// tomava 401 ao tentar logar. So parecia funcionar nos testes porque
// foram feitos na mesma aba onde o Guilherme ja tinha entrado como
// Morolar. Agora existe um unico formulario e uma unica rota: tenta
// a conta Morolar (env vars) primeiro e, se usuario/senha nao
// baterem, tenta como cliente externo cadastrado na tabela clients
// (verificarLoginGlobal, que busca por login sem precisar saber o
// slug). app/login/page.tsx le o campo "tipo" da resposta pra saber
// pra onde redirecionar.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  // 1) Conta Morolar (env vars + g3d_session) -- fluxo original, intacto.
  const expectedUser = process.env.AUTH_USERNAME;
  const salt = process.env.AUTH_PASSWORD_SALT;
  const expectedHash = process.env.AUTH_PASSWORD_HASH;
  const sessionSecret = process.env.AUTH_SESSION_SECRET;

  if (expectedUser && salt && expectedHash && sessionSecret && username === expectedUser) {
    const hash = crypto.scryptSync(password, salt, 64);
    const expectedBuf = Buffer.from(expectedHash, "hex");
    const hashOk = hash.length === expectedBuf.length && crypto.timingSafeEqual(hash, expectedBuf);
    if (hashOk) {
      const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
      const exp = Date.now() + maxAgeMs;
      const sig = crypto.createHmac("sha256", sessionSecret).update(String(exp)).digest("hex");
      const token = `${exp}.${sig}`;

      const res = NextResponse.json({ ok: true, tipo: "morolar" });
      res.cookies.set("g3d_session", token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: Math.floor(maxAgeMs / 1000),
      });
      return res;
    }
  }

  // 2) Nao bateu com a Morolar -- tenta como cliente externo (ex: Plez
  // Store). O usuario so digita usuario/senha, sem saber o slug, entao
  // a busca e feita por login em qualquer linha da tabela clients.
  const cliente = await verificarLoginGlobal(username, password);
  if (cliente) {
    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const token = criarClientSessionCookie({
      clientId: cliente.id,
      abas: cliente.abasPermitidas,
      exp,
    });
    const res = NextResponse.json({
      ok: true,
      tipo: "cliente",
      slug: cliente.id,
      abas: cliente.abasPermitidas,
    });
    res.cookies.set("client_session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(exp),
    });
    return res;
  }

  return NextResponse.json({ error: "Usuario ou senha incorretos" }, { status: 401 });
}
