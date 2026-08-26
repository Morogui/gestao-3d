// Guarda o token OAuth da Shopee numa tabela do banco (nao so em cookie)
// -- mesmo fix ja aplicado a ML em 2026-08-14 (ver lib/ml-auth.ts).
//
// Causa raiz encontrada em 2026-08-26, reclamacao do Guilherme: "antes o
// mercado livre que caia toda hora, agora a shopee esta caindo toda hora
// do nosso sistema". Depois do fix da ML (lib/ml-auth.ts), sobrou
// exatamente o MESMO bug do lado da Shopee: getValidShopeeAccessToken()
// (lib/shopee-orders.ts) e shopeeConectado() (lib/pedidos-cache.ts) so
// liam cookie httpOnly, setado unicamente no navegador de quem autorizou
// o app (/api/shopee/callback). O cron de 1 em 1 minuto (vercel.json)
// roda como chamada servidor-a-servidor da propria Vercel, sem NENHUM
// cookie de navegador por tras -- entao sempre que o cron tentava
// sincronizar, a Shopee aparecia "desconectada" e nenhum pedido era
// atualizado (so funcionava de verdade quando alguem abria a aba
// Estoque/Vendas com o cookie do navegador ainda vivo). Como o
// access_token da Shopee dura so 4h (bem menos que a ML), bastava passar
// 4h sem ninguem abrir o navegador pra sincronizacao parar de vez ate a
// proxima visita -- dando a impressao de "cair toda hora".
//
// A partir de agora o token mora na tabela shopee_auth (linha unica --
// mesma limitacao de loja unica de antes, so que acessivel de qualquer
// contexto, com ou sem cookie). getValidShopeeAccessToken() renova
// sozinho via refresh_token quando o access_token guardado ja venceu ou
// esta perto de vencer, e persiste o token renovado de volta no BANCO --
// nao so em cookie, que o cron nunca consegue gravar de qualquer jeito.
import { cookies } from "next/headers";
import { sql } from "./db";
import { ShopeeTokenResponse, refreshAccessToken } from "./shopee";

async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS shopee_auth (
      id INT PRIMARY KEY DEFAULT 1,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT shopee_auth_linha_unica CHECK (id = 1)
    )
  `;
}

interface ShopeeAuthRow {
  access_token: string;
  refresh_token: string;
  shop_id: string;
  expires_at: string;
}

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export async function salvarTokensShopee(
  token: ShopeeTokenResponse,
  shopId: number
): Promise<void> {
  await garantirTabela();
  const expiresAt = new Date(Date.now() + token.expire_in * 1000).toISOString();
  await sql`
    INSERT INTO shopee_auth (id, access_token, refresh_token, shop_id, expires_at, atualizado_em)
    VALUES (1, ${token.access_token}, ${token.refresh_token}, ${String(shopId)}, ${expiresAt}, now())
    ON CONFLICT (id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      shop_id = EXCLUDED.shop_id,
      expires_at = EXCLUDED.expires_at,
      atualizado_em = now()
  `;

  // Best-effort -- mesmo espirito do lib/ml-auth.ts: cookies() so
  // consegue gravar dentro de um Route Handler com uma resposta de
  // verdade por tras (uma chamada do cron nao tem navegador nenhum
  // esperando um Set-Cookie). Nunca deve derrubar a gravacao no banco
  // por causa disso.
  try {
    const store = cookies();
    store.set("shopee_access_token", token.access_token, {
      ...cookieOptions,
      maxAge: token.expire_in,
    });
    store.set("shopee_refresh_token", token.refresh_token, {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    });
    store.set("shopee_shop_id", String(shopId), {
      ...cookieOptions,
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // contexto sem permissao de escrita de cookie (ex: cron) -- ok, o
    // banco ja e a fonte de verdade.
  }
}

// Margem de seguranca antes de considerar o access_token "vencendo" --
// evita comecar uma chamada com um token que expira no meio do caminho.
const MARGEM_SEGURANCA_MS = 2 * 60 * 1000;

// Substitui toda leitura direta de cookie("shopee_shop_id"/"shopee_
// access_token") no resto do sistema. Sempre olha o banco primeiro
// (funciona de qualquer contexto, inclusive o cron sem cookie nenhum);
// renova sozinho via refresh_token quando o access_token guardado ja
// venceu ou esta perto de vencer.
export async function getValidShopeeAccessToken(): Promise<
  { accessToken: string; shopId: number } | null
> {
  await garantirTabela();
  const rows = (await sql`
    SELECT access_token, refresh_token, shop_id, expires_at::text AS expires_at
    FROM shopee_auth WHERE id = 1
  `) as ShopeeAuthRow[];
  if (rows.length === 0) return null;
  const row = rows[0];
  const shopId = Number(row.shop_id);

  const expiraEm = new Date(row.expires_at).getTime();
  if (expiraEm - Date.now() > MARGEM_SEGURANCA_MS) {
    return { accessToken: row.access_token, shopId };
  }

  const renovado = await refreshAccessToken(row.refresh_token, shopId);
  if (!renovado) return null;

  await salvarTokensShopee(renovado, shopId);
  return { accessToken: renovado.access_token, shopId };
}

// Versao booleana pra quem so precisa saber "tem loja Shopee cadastrada?"
// (sem se importar se o access_token guardado esta fresco ou nao) -- ver
// lib/pedidos-cache.ts, shopeeConectado(). Antes checava so cookie; agora
// checa o banco, que e a fonte de verdade e existe independente de
// cookie/sessao de navegador -- e isso que faz o cron de 1 em 1 minuto
// finalmente conseguir sincronizar a Shopee sozinho.
export async function shopeeEstaConectado(): Promise<boolean> {
  await garantirTabela();
  const rows = (await sql`SELECT 1 AS ok FROM shopee_auth WHERE id = 1`) as { ok: number }[];
  return rows.length > 0;
}
