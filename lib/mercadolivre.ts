// Configuração e helpers de baixo nível para a integração com a API do
// Mercado Livre (OAuth2 + endpoints de vendas/envios).
//
// Credenciais vêm de variáveis de ambiente — nunca ficam hardcoded aqui
// nem são commitadas no repositório (que é público no GitHub).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não configurada. Adicione em Vercel > Settings > Environment Variables.`
    );
  }
  return value;
}

export function getMLConfig() {
  return {
    clientId: requireEnv("ML_CLIENT_ID"),
    clientSecret: requireEnv("ML_CLIENT_SECRET"),
    redirectUri: requireEnv("ML_REDIRECT_URI"),
  };
}

export const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
export const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
export const ML_API_BASE = "https://api.mercadolibre.com";

export interface MLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

export function buildAuthorizationUrl(): string {
  const { clientId, redirectUri } = getMLConfig();
  const url = new URL(ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export async function exchangeCodeForToken(
  code: string
): Promise<MLTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getMLConfig();

  const resp = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Falha ao trocar code por token (${resp.status}): ${detail}`);
  }

  return resp.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<MLTokenResponse | null> {
  const { clientId, clientSecret } = getMLConfig();

  const resp = await fetch(ML_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) return null;
  return resp.json();
}

// Mapeia o status do pedido da ML para um rótulo amigável em português.
export function labelOrderStatus(status: string | undefined): string {
  switch (status) {
    case "confirmed":
      return "Confirmado";
    case "payment_required":
      return "Aguardando pagamento";
    case "payment_in_process":
      return "Pagamento em processamento";
    case "paid":
      return "Pago";
    case "partially_paid":
      return "Parcialmente pago";
    case "partially_refunded":
      return "Parcialmente reembolsado";
    case "pending_cancel":
      return "Cancelamento pendente";
    case "cancelled":
      return "Cancelado";
    case "invalidated":
      return "Invalidado";
    default:
      return status ?? "—";
  }
}

// Mapeia o "logistic_type" do envio da ML para um rótulo amigável.
export function labelLogisticType(logisticType: string | undefined): string {
  switch (logisticType) {
    case "fulfillment":
      return "Full";
    case "self_service":
      return "Flex";
    case "cross_docking":
      return "Coleta (Agência)";
    case "xd_drop_off":
      return "Coleta (Agência)";
    case "drop_off":
      return "Correios/Agência";
    case "custom":
      return "Envio próprio";
    case "not_specified":
      return "A combinar";
    default:
      return logisticType ?? "—";
  }
}
