import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { clienteMlEstaConectado } from "@/lib/client-ml-auth";
import { buscarPedidosClienteMLRange, ClientOrderFull } from "@/lib/client-ml-orders";

export const dynamic = "force-dynamic";

// Vendas de um cliente externo (multi-tenant). O client_id vem SEMPRE da
// sessao verificada no cookie client_session, nunca de um parametro da
// URL -- assim um cliente nunca consegue ver dados de outro so trocando
// o slug. Pedido do Guilherme em 2026-09-14.
//
// 2026-09-15: reformulada pra trazer, igual a aba Vendas interna da
// Morolar -- valor vendido no dia, top produtos vendidos e vendas por
// modalidade de envio. Como o sistema dos clientes ainda nao tem o SKU
// deles cadastrado, tudo aqui e identificado pelo MLB (item id da propria
// ML) -- ver lib/client-ml-orders.ts.
function todaySP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function resumo(orders: ClientOrderFull[]): { faturamento: number; pedidos: number } {
  return {
    faturamento: orders.reduce((s, o) => s + o.total, 0),
    pedidos: orders.length,
  };
}

interface RankingItem {
  itemId: string;
  titulo: string;
  quantidade: number;
  pedidos: number;
}

function rankingPorQuantidade(orders: ClientOrderFull[]): RankingItem[] {
  const porItem = new Map<string, RankingItem>();
  for (const order of orders) {
    for (const item of order.itens) {
      const atual = porItem.get(item.itemId) ?? {
        itemId: item.itemId,
        titulo: item.titulo,
        quantidade: 0,
        pedidos: 0,
      };
      atual.quantidade += item.quantidade;
      atual.pedidos += 1;
      porItem.set(item.itemId, atual);
    }
  }
  return Array.from(porItem.values()).sort((a, b) => b.quantidade - a.quantidade);
}

function contarModalidades(orders: ClientOrderFull[]): { full: number; flex: number; envioProprio: number } {
  let full = 0;
  let flex = 0;
  let envioProprio = 0;
  for (const o of orders) {
    if (o.shippingMode === "Full") full++;
    else if (o.shippingMode === "Flex") flex++;
    else envioProprio++;
  }
  return { full, flex, envioProprio };
}

export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const conectado = await clienteMlEstaConectado(sessao.clientId);
  if (!conectado) {
    return NextResponse.json({ conectado: false });
  }

  const { searchParams } = new URL(req.url);
  const hoje = todaySP();
  const deParam = searchParams.get("de");
  const ateParam = searchParams.get("ate");
  const de = deParam && /^\d{4}-\d{2}-\d{2}$/.test(deParam) ? deParam : hoje;
  const ate = ateParam && /^\d{4}-\d{2}-\d{2}$/.test(ateParam) ? ateParam : hoje;

  const periodoEhHoje = de === hoje && ate === hoje;

  const [ordersHoje, ordersPeriodo] = await Promise.all([
    buscarPedidosClienteMLRange(sessao.clientId, hoje, hoje),
    periodoEhHoje
      ? Promise.resolve(null)
      : buscarPedidosClienteMLRange(sessao.clientId, de, ate),
  ]);

  if (ordersHoje === null) {
    return NextResponse.json({ conectado: true, erro: true });
  }

  const ordersDoPeriodo = periodoEhHoje ? ordersHoje : ordersPeriodo ?? [];

  return NextResponse.json({
    conectado: true,
    erro: false,
    hoje: resumo(ordersHoje),
    periodo: { de, ate, ...resumo(ordersDoPeriodo) },
    ranking: rankingPorQuantidade(ordersDoPeriodo),
    modalidades: contarModalidades(ordersDoPeriodo),
  });
}
