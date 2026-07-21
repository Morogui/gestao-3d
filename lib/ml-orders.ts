import { cookies } from "next/headers";
import { ML_API_BASE, labelLogisticType } from "./mercadolivre";

export interface OrderItemSummary {
  itemId: string;
  title: string;
  quantity: number;
  sku: string;
  // true = veio do campo "SKU" cadastrado no anúncio (seller_custom_field);
  // false = a ML não tem SKU cadastrado nesse anúncio e o valor mostrado é
  // o ID do item (MLBxxxx), só como referência.
  hasCustomSku: boolean;
  thumbnail: string | null;
  // DEBUG temporário — motivo de não ter foto, pra diagnosticar com o
  // usuário. Remover quando o problema da foto estiver resolvido.
  photoDebug?: string;
}

export interface OrderSummary {
  id: number;
  dateCreated: string;
  buyerNickname: string;
  items: OrderItemSummary[];
  totalAmount: number;
  status: string;
  shippingMode: string;
}

export type OrdersResult =
  | { connected: false }
  | { connected: true; error: true }
  | { connected: true; error: false; orders: OrderSummary[] };

interface MLOrderItem {
  item?: { id?: string; title?: string; seller_custom_field?: string };
  quantity?: number;
}

interface MLOrder {
  id: number;
  date_created: string;
  buyer?: { nickname?: string };
  order_items?: MLOrderItem[];
  total_amount?: number;
  status?: string;
  shipping?: { id?: number };
}

interface MLItemDetail {
  id: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  seller_custom_field?: string;
  pictures?: { secure_url?: string; url?: string }[];
}

function toHttps(url: string | undefined | null): string | null {
  if (!url) return null;
  return url.startsWith("http://") ? url.replace("http://", "https://") : url;
}

// A ML retorna a foto em lugares diferentes dependendo do item:
// secure_thumbnail (https, preferível), thumbnail (às vezes http) e,
// em último caso, a primeira foto da lista "pictures". Tenta nessa ordem.
function pickThumbnail(detail: MLItemDetail | undefined): string | null {
  if (!detail) return null;
  return (
    toHttps(detail.secure_thumbnail) ??
    toHttps(detail.thumbnail) ??
    toHttps(detail.pictures?.[0]?.secure_url) ??
    toHttps(detail.pictures?.[0]?.url) ??
    null
  );
}

// Busca detalhes (foto + SKU) de uma lista de item ids em uma única
// chamada usando o endpoint multiget /items?ids=... da ML (mais rápido
// do que uma chamada por item).
interface ItemDetailsResult {
  map: Map<string, MLItemDetail>;
  // por item id que falhou, guarda o motivo (status HTTP ou msg de erro) —
  // debug temporário pra achar a causa da foto sumida.
  errorsByItemId: Map<string, string>;
}

async function fetchItemDetails(
  itemIds: string[],
  accessToken: string
): Promise<ItemDetailsResult> {
  const map = new Map<string, MLItemDetail>();
  const errorsByItemId = new Map<string, string>();
  const uniqueIds = Array.from(new Set(itemIds)).filter(Boolean);
  if (uniqueIds.length === 0) return { map, errorsByItemId };

  // A API multiget aceita até 20 ids por chamada. Não filtramos por
  // "attributes" aqui de propósito — pedir só alguns campos às vezes faz
  // a ML omitir a foto da resposta; buscando o item inteiro garantimos
  // que thumbnail/secure_thumbnail/pictures venham preenchidos.
  //
  // IMPORTANTE: esse endpoint é chamado SEM o token do vendedor. Dados
  // de catálogo (foto, título) são públicos na ML; mandar o
  // Authorization aqui é o que disparava 403
  // PA_UNAUTHORIZED_RESULT_FROM_POLICIES, porque o app não tem o escopo
  // "Publicação e sincronização" — sem o header, a ML trata como
  // consulta pública e devolve os dados normalmente.
  for (let i = 0; i < uniqueIds.length; i += 20) {
    const batch = uniqueIds.slice(i, i + 20);
    try {
      const resp = await fetch(
        `${ML_API_BASE}/items?ids=${batch.join(",")}`,
        { cache: "no-store" }
      );
      if (!resp.ok) {
        const bodyText = await resp.text().catch(() => "");
        const msg = `HTTP ${resp.status} no /items: ${bodyText.slice(0, 200)}`;
        console.error(`[ML orders] multiget items respondeu ${resp.status}`, bodyText);
        for (const id of batch) errorsByItemId.set(id, msg);
        continue;
      }
      const data = await resp.json();
      for (const entry of data ?? []) {
        const id = entry?.body?.id ?? entry?.id;
        if (entry?.code === 200 && entry.body?.id) {
          map.set(entry.body.id, entry.body);
        } else {
          const msg = `código ${entry?.code} no item ${id}: ${JSON.stringify(entry?.body).slice(0, 150)}`;
          console.error("[ML orders] item multiget com erro:", msg);
          if (id) errorsByItemId.set(id, msg);
        }
      }
    } catch (err) {
      const msg = `erro de rede: ${String(err).slice(0, 150)}`;
      console.error("[ML orders] erro no multiget de items:", err);
      for (const id of batch) errorsByItemId.set(id, msg);
    }
  }
  return { map, errorsByItemId };
}

// Extrai a modalidade de envio de forma tolerante a diferenças no
// formato da resposta da API de shipments — nem sempre o campo vem no
// mesmo lugar dependendo do tipo de envio.
function extractLogisticType(shipData: any): string | undefined {
  return (
    shipData?.logistic_type ??
    shipData?.shipping_option?.logistic_type ??
    shipData?.logistic?.type ??
    undefined
  );
}

// Formata um Date no fuso de São Paulo como "YYYY-MM-DDTHH:mm:ss.000-03:00",
// formato que a API de orders/search espera nos filtros de data.
function toMLDateTime(date: Date, endOfDay: boolean): string {
  // America/Sao_Paulo é sempre -03:00 (não tem mais horário de verão desde 2019)
  const isoLocal = new Date(date.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${isoLocal}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`;
}

// Busca os pedidos do vendedor autenticado num intervalo de datas. Roda no
// servidor (Server Component), usando o access_token guardado em cookie
// httpOnly no /api/mercadolivre/callback.
//
// Se `day` não for informado, usa o dia de hoje (fuso de São Paulo) como
// padrão — é isso que aparece na aba Vendas ao abrir a página, com um
// filtro de data pra consultar outros dias.
//
// Nota: se o access_token tiver expirado (dura ~6h), a chamada falha com
// 401 e devolvemos { connected: true, error: true } — a renovação
// automática via refresh_token fica pra uma próxima iteração (precisa
// rodar num Route Handler, que consegue re-gravar cookies; um Server
// Component não consegue).
export async function getOrders(day?: string): Promise<OrdersResult> {
  const targetDate = day ? new Date(`${day}T12:00:00-03:00`) : new Date();
  return fetchOrdersInRange(toMLDateTime(targetDate, false), toMLDateTime(targetDate, true));
}

// Variante para janelas maiores que um dia — usada pela aba Produção pra
// calcular a velocidade de venda semanal (Tiers A/B/C). `fromDay`/`toDay`
// no formato "YYYY-MM-DD" (fuso São Paulo).
export async function getOrdersRange(
  fromDay: string,
  toDay: string
): Promise<OrdersResult> {
  const from = toMLDateTime(new Date(`${fromDay}T12:00:00-03:00`), false);
  const to = toMLDateTime(new Date(`${toDay}T12:00:00-03:00`), true);
  return fetchOrdersInRange(from, to);
}

async function fetchOrdersInRange(
  dateFrom: string,
  dateTo: string
): Promise<OrdersResult> {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;

  if (!accessToken || !userId) {
    return { connected: false };
  }

  // Pagina até 500 pedidos (10 páginas de 50) — suficiente pra uma janela
  // semanal de vendas; evita truncar silenciosamente contas com volume alto.
  const rawOrders: MLOrder[] = [];
  const PAGE_SIZE = 50;
  const MAX_PAGES = 10;
  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetch(
      `${ML_API_BASE}/orders/search?seller=${userId}&sort=date_desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
        `&order.date_created.from=${encodeURIComponent(dateFrom)}` +
        `&order.date_created.to=${encodeURIComponent(dateTo)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
    );

    if (!resp.ok) {
      if (page === 0) return { connected: true, error: true };
      break;
    }

    const data = await resp.json();
    const pageResults: MLOrder[] = data.results ?? [];
    rawOrders.push(...pageResults);

    const total = data.paging?.total ?? pageResults.length;
    if (rawOrders.length >= total || pageResults.length < PAGE_SIZE) break;
  }

  // Busca foto + SKU de todos os itens de todos os pedidos de uma vez
  const allItemIds = rawOrders.flatMap((order) =>
    (order.order_items ?? [])
      .map((oi) => oi.item?.id)
      .filter((id): id is string => Boolean(id))
  );
  const { map: itemDetails, errorsByItemId } = await fetchItemDetails(
    allItemIds,
    accessToken
  );

  const orders = await Promise.all(
    rawOrders.map(async (order): Promise<OrderSummary> => {
      const items: OrderItemSummary[] = (order.order_items ?? []).map((oi) => {
        const detail = oi.item?.id ? itemDetails.get(oi.item.id) : undefined;
        const customSku =
          oi.item?.seller_custom_field || detail?.seller_custom_field || "";
        const thumbnail = pickThumbnail(detail);
        let photoDebug: string | undefined;
        if (!thumbnail) {
          photoDebug = oi.item?.id
            ? errorsByItemId.get(oi.item.id) ??
              (detail
                ? "item encontrado, mas sem thumbnail/secure_thumbnail/pictures no corpo"
                : "item não veio na resposta do multiget /items")
            : "pedido sem item.id";
        }
        return {
          itemId: oi.item?.id ?? "—",
          title: oi.item?.title ?? "item",
          quantity: oi.quantity ?? 1,
          sku: customSku || oi.item?.id || "—",
          hasCustomSku: Boolean(customSku),
          thumbnail,
          photoDebug,
        };
      });

      let shippingMode = "Mercado Envios";
      const shippingId = order.shipping?.id;
      if (shippingId) {
        try {
          const shipResp = await fetch(
            `${ML_API_BASE}/shipments/${shippingId}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              cache: "no-store",
            }
          );
          if (shipResp.ok) {
            const shipData = await shipResp.json();
            const logisticType = extractLogisticType(shipData);
            if (logisticType) {
              shippingMode = labelLogisticType(logisticType);
            } else if (shipData?.mode) {
              // fallback: pelo menos mostra o modo cru da ML se não achar
              // o logistic_type (ajuda a diagnosticar casos não mapeados)
              shippingMode = `Mercado Envios (${shipData.mode})`;
            }
          } else {
            console.error(
              `[ML orders] shipment ${shippingId} respondeu ${shipResp.status}`
            );
          }
        } catch (err) {
          console.error(`[ML orders] erro ao buscar shipment ${shippingId}:`, err);
        }
      } else {
        shippingMode = "—";
      }

      return {
        id: order.id,
        dateCreated: order.date_created,
        buyerNickname: order.buyer?.nickname ?? "—",
        items,
        totalAmount: order.total_amount ?? 0,
        status: order.status ?? "—",
        shippingMode,
      };
    })
  );

  return { connected: true, error: false, orders };
}
