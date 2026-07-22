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

// Leitura do estoque real no Full via a API da ML — modelo "User
// Products" (UP). Documentação: developers.mercadolivre.com.br/pt_br/
// user-products e /estoque-distribuido.
//
// Fluxo (só leitura, não dá pra editar o estoque Full por API):
// 1) GET /items/$ITEM_ID -> devolve user_product_id do anúncio (quando o
//    vendedor já está no modelo UP; senão vem null/ausente).
// 2) GET /user-products/$USER_PRODUCT_ID/stock -> devolve "locations",
//    cada uma com um "type" (meli_facility = Full, selling_address =
//    Flex, seller_warehouse = multi-origem) e "quantity". Somamos só as
//    localizações meli_facility.
//
// Um mesmo user_product_id pode ser compartilhado por vários item_id
// (variações do mesmo produto físico) — por isso o resultado é indexado
// tanto por item quanto por user_product_id, pra quem for somar por
// placa conseguir deduplicar antes de somar (evita contar o mesmo
// estoque físico duas vezes quando dois anúncios apontam pro mesmo UP).
export interface FullStockPorItem {
  userProductId: string | null;
  fullQuantity: number | null; // null = não foi possível ler via API
}

export interface FullStockLookup {
  perItem: Map<string, FullStockPorItem>;
  perUserProduct: Map<string, number>;
}

// Verifica se o vendedor já está no modelo "User Products" da ML —
// pré-requisito documentado pra existir user_product_id (e portanto pra
// conseguir ler o estoque Full via /user-products/$ID/stock). Sem essa
// tag, todo item volta sem user_product_id e a leitura automática cai
// pro valor manual pra 100% das placas — útil pra diagnosticar isso em
// vez de só "não funcionou".
export async function checkUserProductSeller(
  userId: string,
  accessToken: string
): Promise<{ isUserProductSeller: boolean; tags: string[] } | null> {
  try {
    const resp = await fetch(`${ML_API_BASE}/users/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const tags: string[] = data?.tags ?? [];
    return { isUserProductSeller: tags.includes("user_product_seller"), tags };
  } catch (err) {
    console.error(`[ML full-stock] erro ao verificar tag user_product_seller:`, err);
    return null;
  }
}

export async function fetchFullStockForItems(
  itemIds: string[],
  accessToken: string
): Promise<FullStockLookup> {
  const perItem = new Map<string, FullStockPorItem>();
  const perUserProduct = new Map<string, number>();
  const uniqueIds = Array.from(new Set(itemIds)).filter(Boolean);
  if (uniqueIds.length === 0) return { perItem, perUserProduct };

  // 1) Descobre o user_product_id de cada item. Autenticado (com o
  // token do vendedor) pra garantir que o campo venha mesmo se não for
  // exposto na consulta pública.
  let semUserProductId = 0;
  await Promise.all(
    uniqueIds.map(async (itemId) => {
      try {
        const resp = await fetch(`${ML_API_BASE}/items/${itemId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!resp.ok) {
          const bodyText = await resp.text().catch(() => "");
          console.error(
            `[ML full-stock] GET /items/${itemId} respondeu ${resp.status}: ${bodyText.slice(0, 200)}`
          );
          perItem.set(itemId, { userProductId: null, fullQuantity: null });
          return;
        }
        const data = await resp.json();
        const userProductId: string | null = data?.user_product_id ?? null;
        if (!userProductId) semUserProductId++;
        perItem.set(itemId, { userProductId, fullQuantity: null });
      } catch (err) {
        console.error(`[ML full-stock] erro ao buscar item ${itemId}:`, err);
        perItem.set(itemId, { userProductId: null, fullQuantity: null });
      }
    })
  );
  if (semUserProductId > 0) {
    console.log(
      `[ML full-stock] ${semUserProductId}/${uniqueIds.length} itens sem user_product_id (conta provavelmente ainda fora do modelo User Products)`
    );
  }

  // 2) Pra cada user_product_id único encontrado, busca o estoque real
  // e soma só as localizações do tipo "meli_facility" (Full).
  const uniqueUserProductIds = Array.from(
    new Set(
      Array.from(perItem.values())
        .map((v) => v.userProductId)
        .filter((v): v is string => Boolean(v))
    )
  );

  await Promise.all(
    uniqueUserProductIds.map(async (upId) => {
      try {
        const resp = await fetch(`${ML_API_BASE}/user-products/${upId}/stock`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!resp.ok) return;
        const data = await resp.json();
        const locations: { type?: string; quantity?: number }[] = data?.locations ?? [];
        const fullQty = locations
          .filter((l) => l.type === "meli_facility")
          .reduce((s, l) => s + (l.quantity ?? 0), 0);
        perUserProduct.set(upId, fullQty);
      } catch (err) {
        console.error(`[ML full-stock] erro ao buscar stock do UP ${upId}:`, err);
      }
    })
  );

  for (const info of perItem.values()) {
    if (info.userProductId) {
      info.fullQuantity = perUserProduct.get(info.userProductId) ?? null;
    }
  }

  return { perItem, perUserProduct };
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
