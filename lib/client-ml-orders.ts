import { getValidClienteMLAccessToken } from "./client-ml-auth";

export interface ClientOrderItem {
  titulo: string;
  sku: string | null;
  quantidade: number;
  precoUnitario: number;
}

export interface ClientOrder {
  id: number;
  dataCriacao: string;
  status: string;
  total: number;
  itens: ClientOrderItem[];
}

const ML_API = "https://api.mercadolibre.com";

export async function buscarPedidosClienteML(clientId: string, limite: number = 50): Promise<ClientOrder[]> {
  const auth = await getValidClienteMLAccessToken(clientId);
  if (!auth) return [];

  const url = `${ML_API}/orders/search?seller=${auth.userId}&sort=date_desc&limit=${limite}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });
  if (!resp.ok) return [];

  const data = await resp.json();
  const resultados = Array.isArray(data.results) ? data.results : [];

  return resultados.map((pedido: any) => mapearPedido(pedido));
}

function mapearPedido(pedido: any): ClientOrder {
  const itens: ClientOrderItem[] = (pedido.order_items || []).map((oi: any) => ({
    titulo: oi.item?.title || "Sem título",
    sku: oi.item?.seller_sku || oi.item?.seller_custom_field || null,
    quantidade: oi.quantity || 0,
    precoUnitario: oi.unit_price || 0,
  }));

  return {
    id: pedido.id,
    dataCriacao: pedido.date_created,
    status: pedido.status,
    total: pedido.total_amount || 0,
    itens,
  };
}

// --- Recomendação de envio Full (2026-09-15) -----------------------------
//
// Pedido do Guilherme: na tela de Planejamento Full de cada cliente, ao
// escolher uma janela (1 semana / 15 dias) e uma data, o sistema tem que
// montar sozinho a recomendação de quanto enviar pro Full, baseado nas
// vendas Full reais que o cliente teve naquele período.
//
// Correção explícita de arquitetura do Guilherme: "Esse sistema dos
// clientes vai puxar direto o MLB do produto... você pega as vendas e aí
// você monta a recomendação do full conforme o MLB, que a plataforma já
// te traz isso." Ou seja, ao contrário do sistema interno da Morolar
// (lib/demanda.ts), que precisa linkar SKU de anúncio -> placa/produto do
// catálogo interno (fonte de vários bugs de cross-matching ao longo do
// projeto), aqui NÃO existe catálogo interno pra linkar: o item id (MLB)
// devolvido pela própria API de pedidos da ML JÁ é o identificador final.
// A "recomendação" é simplesmente: soma de quantidade vendida no Full,
// por MLB, no período escolhido.
const VENDIDO_ML = new Set(["paid", "partially_paid"]);

// Formata um Date no fuso de São Paulo como "YYYY-MM-DDTHH:mm:ss.000-03:00"
// (mesmo formato exigido pelos filtros order.date_created.from/.to da API
// de orders/search) -- espelha toMLDateTime de lib/ml-orders.ts.
function toMLDateTime(date: Date, endOfDay: boolean): string {
  const isoLocal = new Date(date.getTime() - 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `${isoLocal}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`;
}

// Extrai o logistic_type do envio de forma tolerante a variações no
// formato da resposta de /shipments/{id} -- espelha extractLogisticType
// de lib/ml-orders.ts.
function extractLogisticType(shipData: any): string | undefined {
  return (
    shipData?.logistic_type ??
    shipData?.shipping_option?.logistic_type ??
    shipData?.logistic?.type ??
    undefined
  );
}

export interface RecomendacaoItemFull {
  itemId: string;
  titulo: string;
  quantidade: number;
}

// Busca os pedidos do cliente num intervalo de datas, filtra só os que
// foram vendidos de verdade (pago/parcialmente pago) e enviados via Full
// (logistic_type === "fulfillment"), e agrupa a quantidade vendida por
// MLB (item id). Retorna null se o cliente não tiver ML conectado ou se
// a primeira chamada à API falhar.
export async function calcularRecomendacaoFull(
  clientId: string,
  fromDay: string,
  toDay: string
): Promise<RecomendacaoItemFull[] | null> {
  const auth = await getValidClienteMLAccessToken(clientId);
  if (!auth) return null;

  const dateFrom = toMLDateTime(new Date(`${fromDay}T12:00:00-03:00`), false);
  const dateTo = toMLDateTime(new Date(`${toDay}T12:00:00-03:00`), true);

  const PAGE_SIZE = 50;
  const MAX_PAGES = 10;
  const rawOrders: any[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const resp = await fetch(
      `${ML_API}/orders/search?seller=${auth.userId}&sort=date_desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}` +
        `&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` }, cache: "no-store" }
    );

    if (!resp.ok) {
      if (page === 0) return null;
      break;
    }

    const data = await resp.json();
    const results: any[] = data.results ?? [];
    rawOrders.push(...results);

    const total = data.paging?.total ?? results.length;
    if (rawOrders.length >= total || results.length < PAGE_SIZE) break;
  }

  // Só conta como venda de verdade (mesma regra de VENDIDO_ML usada no
  // sistema interno da Morolar -- ver lib/ml-orders.ts).
  const vendidos = rawOrders.filter((order) => VENDIDO_ML.has(order.status ?? ""));

  // Descobre a modalidade de envio de cada pedido olhando o shipment.
  const comModo = await Promise.all(
    vendidos.map(async (order) => {
      const shippingId = order.shipping?.id;
      if (!shippingId) return { order, isFull: false };
      try {
        const resp = await fetch(`${ML_API}/shipments/${shippingId}`, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          cache: "no-store",
        });
        if (!resp.ok) return { order, isFull: false };
        const shipData = await resp.json();
        const logisticType = extractLogisticType(shipData);
        return { order, isFull: logisticType === "fulfillment" };
      } catch {
        return { order, isFull: false };
      }
    })
  );

  const porItem = new Map<string, RecomendacaoItemFull>();
  for (const { order, isFull } of comModo) {
    if (!isFull) continue;
    for (const oi of order.order_items ?? []) {
      const itemId: string | undefined = oi.item?.id;
      if (!itemId) continue;
      const atual = porItem.get(itemId) ?? {
        itemId,
        titulo: oi.item?.title ?? itemId,
        quantidade: 0,
      };
      atual.quantidade += oi.quantity ?? 0;
      porItem.set(itemId, atual);
    }
  }

  return Array.from(porItem.values()).sort((a, b) => b.quantidade - a.quantidade);
}
