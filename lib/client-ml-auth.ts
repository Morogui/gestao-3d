import { sql } from "./db";
import { MLTokenResponse, refreshAccessToken } from "./mercadolivre";

// Token store do Mercado Livre por cliente (multi-tenant) -- espelha
// lib/ml-auth.ts (que guarda o token unico da Morolar em ml_auth), so
// que numa tabela SEPARADA e chaveada por client_id, pra cada cliente
// externo (ex: "plez") conectar a PROPRIA conta ML sem qualquer risco
// de misturar com o token da Morolar. Pedido do Guilherme em
// 2026-09-14.
async function garantirTabela() {
  await sql`
  CREATE TABLE IF NOT EXISTS client_ml_auth (
  client_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `;
}

interface Row {
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_at: string;
}

export async function salvarTokensClienteML(
  clientId: string,
  token: MLTokenResponse
  ): Promise<void> {
  await garantirTabela();
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  await sql`
  INSERT INTO client_ml_auth (client_id, access_token, refresh_token, user_id, expires_at, atualizado_em)
  VALUES (${clientId}, ${token.access_token}, ${token.refresh_token}, ${String(token.user_id)}, ${expiresAt}, now())
  ON CONFLICT (client_id) DO UPDATE SET
  access_token = EXCLUDED.access_token,
  refresh_token = EXCLUDED.refresh_token,
  user_id = EXCLUDED.user_id,
  expires_at = EXCLUDED.expires_at,
  atualizado_em = now()
  `;
}

const MARGEM_SEGURANCA_MS = 2 * 60 * 1000;

export async function getValidClienteMLAccessToken(
  clientId: string
  ): Promise<{ accessToken: string; userId: string } | null> {
  await garantirTabela();
  const rows = (await sql`
  SELECT access_token, refresh_token, user_id, expires_at::text AS expires_at
  FROM client_ml_auth WHERE client_id = ${clientId}
  `) as Row[];
  if (rows.length === 0) return null;
  const row = rows[0];

const expiraEm = new Date(row.expires_at).getTime();
  if (expiraEm - Date.now() > MARGEM_SEGURANCA_MS) {
    return { accessToken: row.access_token, userId: row.user_id };
  }

const renovado = await refreshAccessToken(row.refresh_token);
  if (!renovado) return null;

await salvarTokensClienteML(clientId, renovado);
  return { accessToken: renovado.access_token, userId: String(renovado.user_id) };
}

export async function clienteMlEstaConectado(clientId: string): Promise<boolean> {
  await garantirTabela();
  const rows = (await sql`SELECT 1 AS ok FROM client_ml_auth WHERE client_id = ${clientId}`) as { ok: number }[];
  return rows.length > 0;
}
