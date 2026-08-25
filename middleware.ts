import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Domínio canônico de produção — o único que efetivamente recebe os
// cookies de sessão da ML e da Shopee depois do OAuth (o redirect_uri de
// ambas as integrações está fixado pra cá: SHOPEE_REDIRECT_URI e o
// equivalente da ML). Bug real encontrado em 2026-07-24: o Guilherme
// tinha uma aba/bookmark apontando pra uma URL de deployment "congelada"
// do Vercel (gestao-3d-ftodds43o-morolar.vercel.app — o hash específico
// de UM deploy antigo, não o alias de produção que se move pro deploy
// mais recente) e ficava preso num loop infinito ao tentar conectar a
// Shopee: autorizava, a Shopee devolvia o code pro callback em
// gestao-3d-ecru.vercel.app (que salvava o cookie ali), mas ele
// continuava acessando o app pela URL antiga — que é OUTRO domínio pro
// navegador, sem nenhum acesso ao cookie salvo no domínio certo — então
// a tela sempre voltava a mostrar "desconectado" e pedia autorização de
// novo, dando a impressão de que "não saía da tela".
//
// Esse middleware redireciona qualquer acesso vindo de um domínio
// *.vercel.app que não seja o canônico de volta pra ele (preservando
// path e query string), pra essa classe de bug nunca mais se repetir —
// mesmo que um deploy futuro gere outro hash de preview e alguém clique
// num link/bookmark antigo por engano. Não afeta um eventual domínio
// próprio (ex: um .com.br) que venha a ser configurado depois, já que a
// checagem só entra em ação pra hosts terminados em ".vercel.app".
const DOMINIO_CANONICO = "gestao-3d-ecru.vercel.app";

const PUBLIC_PATHS = ["/", "/painel", "/login", "/logo-7x7.png"];

// Qualquer arquivo estático de imagem direto na raiz de /public (logo,
// fotos do carrossel da /painel, etc.) é sempre público — por definição
// tudo que está em /public é servido como asset estático, então barrar
// esses arquivos atrás de sessão nunca fazia sentido e quebrava
// silenciosamente qualquer imagem nova adicionada à página pública
// /painel sem que alguém lembrasse de listar o arquivo aqui manualmente
// (bug real encontrado em 2026-08-25: as fotos do carrossel da /painel
// redirecionavam pra /login pra qualquer visitante sem cookie de sessão,
// porque só /logo-7x7.png estava na allowlist).
const PUBLIC_STATIC_FILE = /\.(png|jpe?g|svg|webp|gif|ico)$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  if (PUBLIC_STATIC_FILE.test(pathname)) return true;
  return false;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("g3d_session")?.value;
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return false;
  const expected = await hmacHex(secret, expStr);
  return expected === sig;
}

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (host.endsWith(".vercel.app") && host !== DOMINIO_CANONICO) {
    const url = req.nextUrl.clone();
    url.host = DOMINIO_CANONICO;
    url.protocol = "https";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  const { pathname } = req.nextUrl;
  if (!isPublicPath(pathname) && !(await hasValidSession(req))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Corrigido em 2026-08-10 — bug real reportado pelo Guilherme: "não está
// puxando pedidos Shopee". Causa raiz: o matcher abaixo cobria TUDO,
// inclusive /api — então o cron da Vercel (que chama
// /api/pedidos/sincronizar de 1 em 1 minuto batendo no host interno de
// cada deploy, tipo gestao-3d-6czpm5gir-morolar.vercel.app, não no
// domínio canônico) caía direto no redirect 308 acima. O
// vercel-cron/webhooks não seguem redirect, então a sincronização
// automática nunca rodava de verdade — só quando alguém abria o site e
// disparava manualmente. Rotas /api nunca são "bookmarkadas" pelo
// Guilherme no navegador (o bug original era só de navegação de página),
// então excluir /api daqui resolve sem reabrir o problema do loop de
// OAuth.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
