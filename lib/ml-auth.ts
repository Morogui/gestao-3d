// Guarda o token OAuth da ML numa tabela do banco (nao so em cookie) --
// pedido do Guilherme em 2026-08-14: "nosso sistema de producao so
// funciona se estivermos conectados com a api... deve salvar as
// informacoes da api e sempre estar funcionando, nao pode travar por
// conta da api".
//
// Causa raiz encontrada: o token so existia em cookie httpOnly (ver
// comentario antigo em app/api/mercadolivre/callback/route.ts -- "cookies
// httpOnly... suficiente pra um uso de conta unica"). O cron de 1 em 1
// minuto (vercel.json) roda como chamada servidor-a-servidor da propria
// Vercel, sem nenhum cookie do navegador do Guilherme por tras -- entao
// nenhuma verificacao baseada em cookies() conseguia autenticar nessa
// chamada, e a sincronizacao "quase em tempo real" so rodava de verdade
// quando alguem abria uma aba do app (a baixa de estoque e a demanda
// ficavam paradas ate isso acontecer). Confirmado ao vivo em 2026-08-14:
// abrir a aba Estoque encontrou 8 baixas atrasadas (10 pecas) que ja
// deveriam ter sido descontadas horas antes.
//
// A partir de agora o token mora na tabela ml_auth (linha unica -- mesma
// limitacao de conta unica de antes, so que acessivel de qualquer
// contexto, com ou sem cookie). getValidMLAccessToken() tambem renova
// sozinho via refresh_token quando o access_token guardado ja venceu ou
// esta perto de vencer, igual a Shopee ja fazia (ver
// lib/shopee-orders.ts, getValidShopeeAccessToken) -- a ML nunca tinha
// ganho esse mesmo conserto.
import { cookies } from "next/headers";
import { sql } from "./db";
import { MLTokenResponse, refreshAccessToken } from "./mercadolivre";

async function garantirTabela() {
    await sql`
        CREATE TABLE IF NOT EXISTS ml_auth (
              id INT PRIMARY KEY DEFAULT 1,
                    access_token TEXT NOT NULL,
                          refresh_token TEXT NOT NULL,
                                user_id TEXT NOT NULL,
                                      expires_at TIMESTAMPTZ NOT NULL,
                                            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
                                                  CONSTRAINT ml_auth_linha_unica CHECK (id = 1)
                                                      )
                                                        `;
}

interface MLAuthRow {
    access_token: string;
    refresh_token: string;
    user_id: string;
    expires_at: string;
}

const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
};

export async function salvarTokensML(token: MLTokenResponse): Promise<void> {
    await garantirTabela();
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    await sql`
        INSERT INTO ml_auth (id, access_token, refresh_token, user_id, expires_at, atualizado_em)
            VALUES (1, ${token.access_token}, ${token.refresh_token}, ${String(token.user_id)}, ${expiresAt}, now())
                ON CONFLICT (id) DO UPDATE SET
                      access_token = EXCLUDED.access_token,
                            refresh_token = EXCLUDED.refresh_token,
                                  user_id = EXCLUDED.user_id,
                                        expires_at = EXCLUDED.expires_at,
                                              atualizado_em = now()
                                                `;

    // Best-effort -- cookies() so consegue gravar dentro de um Route
    // Handler/Server Action com uma resposta de verdade por tras (uma
    // chamada do cron nao tem navegador nenhum esperando um Set-Cookie).
    // Nunca deve derrubar a gravacao no banco por causa disso.
    try {
          const store = cookies();
          store.set("ml_access_token", token.access_token, {
                  ...cookieOptions,
                  maxAge: token.expires_in,
          });
          store.set("ml_refresh_token", token.refresh_token, {
                  ...cookieOptions,
                  maxAge: 60 * 60 * 24 * 180,
          });
          store.set("ml_user_id", String(token.user_id), {
                  ...cookieOptions,
                  maxAge: 60 * 60 * 24 * 180,
          });
    } catch {
          // contexto sem permissao de escrita de cookie (ex: cron) -- ok, o
          // banco ja e a fonte de verdade.
    }
}

// Margem de seguranca antes de considerar o access_token "vencendo" --
// evita comecar uma chamada com um token que expira no meio do caminho.
const MARGEM_SEGURANCA_MS = 2 * 60 * 1000;

// Substitui toda leitura direta de cookie("ml_access_token") no resto do
// sistema. Sempre olha o banco primeiro (funciona de qualquer contexto,
// inclusive o cron sem cookie nenhum); renova sozinho via refresh_token
// quando o access_token guardado ja venceu ou esta perto de vencer.
export async function getValidMLAccessToken(): Promise<{ accessToken: string; userId: string } | null> {
    await garantirTabela();
    const rows = (await sql`
        SELECT access_token, refresh_token, user_id, expires_at::text AS expires_at
            FROM ml_auth WHERE id = 1
              `) as MLAuthRow[];
    if (rows.length === 0) return null;
    const row = rows[0];

    const expiraEm = new Date(row.expires_at).getTime();
    if (expiraEm - Date.now() > MARGEM_SEGURANCA_MS) {
          return { accessToken: row.access_token, userId: row.user_id };
    }

    const renovado = await refreshAccessToken(row.refresh_token);
    if (!renovado) return null;

    await salvarTokensML(renovado);
    return { accessToken: renovado.access_token, userId: String(renovado.user_id) };
}

// Versao booleana pra quem so precisa saber "tem conta ML cadastrada?"
// (sem se importar se o access_token guardado esta fresco ou nao) -- ver
// lib/pedidos-cache.ts, mlConectado(). Antes checava so cookie; agora
// checa o banco, que e a fonte de verdade e existe independente de
// cookie/sessao de navegador -- e isso que faz o cron de 1 em 1 minuto
// finalmente conseguir autenticar sozinho.
export async function mlEstaConectado(): Promise<boolean> {
    await garantirTabela();
    const rows = (await sql`SELECT 1 AS ok FROM ml_auth WHERE id = 1`) as { ok: number }[];
    return rows.length > 0;
}


