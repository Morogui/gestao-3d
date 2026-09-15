import { getValidClienteMLAccessToken } from "./client-ml-auth";
import { labelLogisticType } from "./mercadolivre";

// --- Tipos "legado" (mantidos por compatibilidade, não usados pelas
// funções novas abaixo) ---------------------------------------------------
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

// --- Vendas do cliente por intervalo de datas, com modalidade de envio ---
//
// Pedido do Guilherme em 2026-09-15: a aba Vendas dos clientes tem que
// mostrar valor vendido no dia, top produtos vendidos e vendas por
// modalidade de envio -- igual a Morolar já tem. E o Planejamento Full
// só pode contar pedidos que saíram DE VERDADE pelo Full (não Flex, não
// envio próprio).
//
// Correção de arquitetura já registrada: o sistema dos clientes NUNCA
// linka com catálogo interno (sem SKU nosso) -- tudo é identificado pelo
// item id da própria ML (MLB), que a API de pedidos já devolve.
export type ModalidadeEnvioCliente = "Full" | "Flex" | "Envio proprio";

export interface ClientOrderItemFull {
  itemId: string;
  titulo: string;
  quantidade: number;
  precoUnitario: number;
}

export interface ClientOrderFull {
  id: number;
  dataCriacao: string;
  status: string;
  total: number;
  shippingMode: ModalidadeEnvioCliente;
  itens: ClientOrderItemFull[];
}

const VENDIDO_ML = new Set(["paid", "partially_paid"]);

// Formata um Date no fuso de São Paulo como "YYYY-MM-DDTHH:mm:ss.000-03:00"
// -- espelha toMLDateTime de lib/ml-orders.ts.
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

// Mapeia o rótulo cru da ML pra uma das 3 modalidades que mostramos pro
// cliente -- mesma convenção de app/vendas/page.tsx (contarModalidadesEnvio)
// no sistema interno da Morolar: Full = fulfillment da própria ML, Flex =
// entrega no mesmo dia via self_service, tudo mais conta como envio
// próprio (Coleta/Correios/Agência/envio combinado).
function classificarModalidade(logisticType: string | undefined): ModalidadeEnvioCliente {
  const label = labelLogisticType(logisticType);
  if (label === "Full") return "Full";
  if (label === "Flex") return "Flex";
  return "Envio proprio";
}

// Busca todos os pedidos VENDIDOS (pago/parcialmente pago) do cliente num
// intervalo de datas, já com a modalidade de envio resolvida por pedido
// (consulta ao /shipments/{id}, em paralelo). Essa é a função base
// reaproveitada tanto pela aba Vendas do cliente (resumo do dia, top
// produtos, modalidades) quanto pela recomendação de envio Full (que
// filtra só shippingMode === "Full" em cima do resultado). Retorna null
// se o cliente não tiver ML conectado ou se a primeira chamada falhar.
export async function buscarPedidosClienteMLRange(
  clientId: string,
  fromDay: string,
  toDay: string
): Promise<ClientOrderFull[] | null> {
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

  // Só conta como venda de verdade (mesma regra usada no sistema interno
  // da Morolar -- ver lib/ml-orders.ts).
  const vendidos = rawOrders.filter((order) => VENDIDO_ML.has(order.status ?? ""));

  const orders = await Promise.all(
    vendidos.map(async (order): Promise<ClientOrderFull> => {
      let shippingMode: ModalidadeEnvioCliente = "Envio proprio";
      const shippingId = order.shipping?.id;
      if (shippingId) {
        try {
          const resp = await fetch(`${ML_API}/shipments/${shippingId}`, {
            headers: { Authorization: `Bearer ${auth.accessToken}` },
            cache: "no-store",
          });
          if (resp.ok) {
            const shipData = await resp.json();
            shippingMode = classificarModalidade(extractLogisticType(shipData));
          }
        } catch {
          // mantém "Envio proprio" como fallback conservador
        }
      }

      const itens: ClientOrderItemFull[] = (order.order_items ?? [])
        .filter((oi: any) => oi.item?.id)
        .map((oi: any) => ({
          itemId: oi.item.id as string,
          titulo: oi.item?.title || "Sem título",
          quantidade: oi.quantity || 0,
          precoUnitario: oi.unit_price || 0,
        }));

      return {
        id: order.id,
        dataCriacao: order.date_created,
        status: order.status,
        total: order.total_amount || 0,
        shippingMode,
        itens,
      };
    })
  );

  return orders;
}

// --- Recomendação de envio Full, com Curva ABC (2026-09-15) ---------------
//
// Pedido do Guilherme: "só devemos contar para o planejamento full os
// produtos que realmente estão no full e tem venda saindo do full, outras
// modalidades não devem contar" -- por isso filtra shippingMode==="Full"
// em cima de buscarPedidosClienteMLRange antes de agrupar.
//
// Curva ABC (classificação clássica de curva de vendas, padrão 80/15/5
// por volume acumulado): ordena os itens por quantidade vendida no Full
// dentro da janela, do maior pro menor, e soma a quantidade acumulada --
// quem completa até 80% do volume total é Curva A, os próximos até 95%
// são Curva B, o resto (últimos 5%) é Curva C. Cada curva tem um
// multiplicador default (A=1.4x, B=1.1x, C=1.0x, pedido do Guilherme em
// 2026-09-15) aplicado em cima da quantidade base vendida -- a
// quantidadeBase e a curva vêm daqui; o multiplicador é aplicado depois
// (na rota ou no front, pra poder ficar editável sem precisar refazer a
// consulta à ML de novo).
export type CurvaABC = "A" | "B" | "C";

export const MULTIPLICADORES_CURVA_DEFAULT: Record<CurvaABC, number> = {
  A: 1.4,
  B: 1.1,
  C: 1.0,
};

export interface RecomendacaoItemFull {
  itemId: string;
  titulo: string;
  quantidadeBase: number;
  curva: CurvaABC;
}

function classificarCurvaABC(
  itens: { itemId: string; quantidade: number }[]
): Map<string, CurvaABC> {
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  const ordenado = [...itens].sort((a, b) => b.quantidade - a.quantidade);
  const curvaPorItem = new Map<string, CurvaABC>();
  let acumulado = 0;
  for (const item of ordenado) {
    acumulado += item.quantidade;
    const pct = total > 0 ? acumulado / total : 0;
    let curva: CurvaABC;
    if (pct <= 0.8) curva = "A";
    else if (pct <= 0.95) curva = "B";
    else curva = "C";
    curvaPorItem.set(item.itemId, curva);
  }
  return curvaPorItem;
}

export async function calcularRecomendacaoFull(
  clientId: string,
  fromDay: string,
  toDay: string
): Promise<RecomendacaoItemFull[] | null> {
  const orders = await buscarPedidosClienteMLRange(clientId, fromDay, toDay);
  if (orders === null) return null;

  const porItem = new Map<string, { itemId: string; titulo: string; quantidade: number }>();
  for (const order of orders) {
    if (order.shippingMode !== "Full") continue;
    for (const item of order.itens) {
      const atual = porItem.get(item.itemId) ?? {
        itemId: item.itemId,
        titulo: item.titulo,
        quantidade: 0,
      };
      atual.quantidade += item.quantidade;
      porItem.set(item.itemId, atual);
    }
  }

  const itensBase = Array.from(porItem.values());
  const curvaPorItem = classificarCurvaABC(itensBase);

  return itensBase
    .map((item) => ({
      itemId: item.itemId,
      titulo: item.titulo,
      quantidadeBase: item.quantidade,
      curva: curvaPorItem.get(item.itemId) ?? "C",
    }))
    .sort((a, b) => b.quantidadeBase - a.quantidadeBase);
}
