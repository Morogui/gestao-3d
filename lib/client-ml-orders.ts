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
