// Configuração e helpers de baixo nível para a integração com a API v2 da
// Shopee (Shopee Open Platform) — OAuth2 + assinatura HMAC-SHA256 exigida
// em toda chamada.
//
// Diferente da ML, a Shopee não usa um client_secret simples: toda
// requisição precisa vir com um "sign" calculado como
// HMAC-SHA256(partner_id + path + timestamp [+ access_token + shop_id
// nas chamadas autenticadas], partner_key). Documentação:
// https://open.shopee.com/documents?module=63&type=2&id=54&version=2
//
// Credenciais vêm de variáveis de ambiente — nunca ficam hardcoded aqui
// nem são commitadas no repositório (que é público no GitHub).

import { createHmac } from "crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não configurada. Adicione em Vercel > Settings > Environment Variables.`
    );
  }
  return value;
}

export type ShopeeEnv = "production" | "sandbox";

export function getShopeeConfig() {
  return {
    partnerId: Number(requireEnv("SHOPEE_PARTNER_ID")),
    partnerKey: requireEnv("SHOPEE_PARTNER_KEY"),
    redirectUri: requireEnv("SHOPEE_REDIRECT_URI"),
    // "sandbox" enquanto o app estiver em modo "Developing" no Shopee Open
    // Platform Console. Depois do Go-Live (e de trocar pelas chaves de
    // produção), muda essa env var pra "production".
    env: (process.env.SHOPEE_ENV === "production"
      ? "production"
      : "sandbox") as ShopeeEnv,
  };
}

export function getShopeeBaseUrl(env: ShopeeEnv): string {
  return env === "production"
    ? "https://partner.shopeemobile.com"
    : "https://partner.test-stable.shopeemobile.com";
}

function sign(partnerKey: string, baseString: string): string {
  return createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  // a Shopee chama o campo de "expire_in" (sem o "s"), diferente da ML
  expire_in: number;
  shop_id_list?: number[];
  merchant_id_list?: number[];
  error?: string;
  message?: string;
}

// Monta a URL de autorização — o usuário abre isso, loga na Shopee,
// escolhe a loja e autoriza; a Shopee redireciona de volta pro
// redirect_uri com "code" e "shop_id" na query string.
export function buildAuthorizationUrl(): string {
  const { partnerId, partnerKey, redirectUri, env } = getShopeeConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const signature = sign(partnerKey, baseString);

  const url = new URL(getShopeeBaseUrl(env) + path);
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signature);
  url.searchParams.set("redirect", redirectUri);
  return url.toString();
}

// Troca o "code" recebido no callback por access_token/refresh_token.
export async function exchangeCodeForToken(
  code: string,
  shopId: number
): Promise<ShopeeTokenResponse> {
  const { partnerId, partnerKey, env } = getShopeeConfig();
  const path = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const signature = sign(partnerKey, baseString);

  const url = new URL(getShopeeBaseUrl(env) + path);
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signature);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, shop_id: shopId, partner_id: partnerId }),
  });

  const data = (await resp.json()) as ShopeeTokenResponse;
  if (!resp.ok || data.error) {
    throw new Error(
      `Falha ao trocar code por token (${resp.status}): ${data.error ?? ""} ${
        data.message ?? ""
      }`.trim()
    );
  }
  return data;
}

// Renova o access_token usando o refresh_token — o access_token da Shopee
// dura só 4h (bem menos que o da ML, que dura ~6h); o refresh_token dura
// 30 dias.
export async function refreshAccessToken(
  refreshToken: string,
  shopId: number
): Promise<ShopeeTokenResponse | null> {
  const { partnerId, partnerKey, env } = getShopeeConfig();
  const path = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}`;
  const signature = sign(partnerKey, baseString);

  const url = new URL(getShopeeBaseUrl(env) + path);
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signature);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: shopId,
      partner_id: partnerId,
    }),
  });

  if (!resp.ok) return null;
  const data = (await resp.json()) as ShopeeTokenResponse;
  if (data.error) return null;
  return data;
}

// Assina uma chamada autenticada (com access_token + shop_id) — usado
// pelas próximas etapas (busca de pedidos) que ainda vamos construir.
export function signAuthenticatedRequest(
  path: string,
  accessToken: string,
  shopId: number
): string {
  const { partnerId, partnerKey, env } = getShopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  const signature = sign(partnerKey, baseString);

  const url = new URL(getShopeeBaseUrl(env) + path);
  url.searchParams.set("partner_id", String(partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", signature);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("shop_id", String(shopId));
  return url.toString();
}

// Mapeia o order_status da Shopee pra um rótulo amigável em português —
// mesmo espírito do labelOrderStatus/labelLogisticType da ML.
export function labelShopeeOrderStatus(status: string | undefined): string {
  switch (status) {
    case "UNPAID":
      return "Aguardando pagamento";
    case "READY_TO_SHIP":
      return "Pronto pra envio";
    case "PROCESSED":
      return "Processado";
    case "SHIPPED":
      return "Enviado";
    case "COMPLETED":
      return "Concluído";
    case "IN_CANCEL":
      return "Cancelamento em andamento";
    case "CANCELLED":
      return "Cancelado";
    case "TO_RETURN":
      return "Em devolução";
    default:
      return status ?? "—";
  }
}
