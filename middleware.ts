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

// Rotas de API que precisam continuar acessíveis SEM sessão porque quem
// chama nunca vai ter o cookie g3d_session: cron da própria Vercel
// (vercel.json), webhooks chamados pelos servidores do Telegram/Mercado
// Livre/Shopee, o próprio endpoint de login (senão ninguém consegue
// logar), e os callbacks de OAuth (redirect de volta da ML/Shopee depois
// de autorizar — quem valida essa rota é o code/state da própria ML,
// não a sessão do site).
//
// Pedido do Guilherme em 2026-08-26: "de maneira alguma as pessoas podem
// ter acesso sem fazer login a nosso sistema". Até esta mudança, o
// matcher no fim do arquivo excluía O CAMINHO INTEIRO "/api/" da
// checagem de sessão (ver comentário histórico logo abaixo, sobre o
// cron) — ou seja, TODA rota de API (produtos, vendas, financeiro,
// estoque, custo, placas...) respondia com os dados reais do negócio
// pra qualquer um que soubesse a URL, sem pedir login nenhum. As páginas
// (ex: /produtos) já redirecionavam pra /login corretamente, mas os
// dados por trás delas (ex: /api/produtos/catalogo) estavam abertos.
// Agora o matcher volta a cobrir /api inteiro, e só esta lista pequena e
// explícita fica de fora da exigência de sessão.
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/logout",
  "/api/telegram/webhook",
  "/api/mercadolivre/webhook",
  "/api/mercadolivre/callback",
  "/api/shopee/callback",
  "/api/pedidos/sincronizar",
  "/api/concorrencia/atualizar",
];

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
  if (PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
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
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") ?? "";
  // Corrigido em 2026-08-29: bug real encontrado pelo Guilherme (aba
  // Vendas zerada mesmo com vendas no dia) — o cron da Vercel bate no
  // host interno do deploy (tipo
  // gestao-3d-7ek20c7i7-morolar.vercel.app), não no domínio canônico, e
  // cron NUNCA segue redirect (308). Como o bloco abaixo redirecionava
  // QUALQUER host ".vercel.app" diferente do canônico antes mesmo de
  // olhar pra isPublicPath, o /api/pedidos/sincronizar do cron (que
  // roda de 1 em 1 minuto) tomava 308 e nunca chegava no handler —
  // silenciosamente, sem erro nenhum nos logs (só o próprio 308). Rotas
  // públicas (cron, webhooks, callbacks OAuth) não dependem de cookie
  // nem de host, então agora pulam esse redirect e vão direto pro
  // handler.
  if (!isPublicPath(pathname) && host.endsWith(".vercel.app") && host !== DOMINIO_CANONICO) {
    const url = req.nextUrl.clone();
    url.host = DOMINIO_CANONICO;
    url.protocol = "https";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (!isPublicPath(pathname) && !(await hasValidSession(req))) {
    // Rotas de API sem sessão recebem 401 (é uma chamada fetch de dentro
    // da página, não uma navegação — redirecionar pro HTML de /login não
    // faz sentido pra quem espera JSON, e ainda vazaria menos informação
    // que devolver os dados de verdade).
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Corrigido em 2026-08-10 — bug real reportado pelo Guilherme: "não está
// puxando pedidos Shopee". Causa raiz original: o matcher cobria TUDO,
// inclusive /api — então o cron da Vercel (que chama
// /api/pedidos/sincronizar de 1 em 1 minuto batendo no host interno de
// cada deploy, tipo gestao-3d-6czpm5gir-morolar.vercel.app, não no
// domínio canônico) caía direto no redirect 308 do bloco de domínio
// acima. A correçãona época foi excluir "api/" do matcher inteiro — o
// que resolveu aquele bug mas abriu a falha de segurança descrita em
// PUBLIC_API_PATHS acima (toda rota de API ficou sem checagem de sessão
// nenhuma). Agora /api volta a passar pelo middleware — o redirect de
// domínio no topo desta função roda ANTES da checagem de sessão, então o
// cron/vercel-cron ainda é redirecionado pro domínio certo primeiro (e
// como bate direto no domínio canônico normalmente, nem precisa desse
// redirect na prática) — e a rota específica do cron
// (/api/pedidos/sincronizar) está na allowlist acima, então continua
// funcionando sem sessão.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
