// Rota temporaria de diagnostico -- pedido do Guilherme em 2026-08-19:
// "consulte as vendas em flex, qual valor estou recebendo e quando na
// minha planilha eu uso o flex para precificar, se bate com o valor que
// a plataforma me devolve". A planilha PRECIFICACAO CERTA usa um valor
// fixo de R$6 na coluna "TAXA FLEX" (aba MERCADO LIVRE, celula L2 = "6",
// sem formula nenhuma) -- essa rota busca pedidos reais enviados por
// Flex (shipping_mode = 'Flex' no pedidos_cache, que vem de
// labelLogisticType('self_service') em lib/mercadolivre.ts) e consulta a
// ML ao vivo pra ver o valor liquido/custo real de cada um, pra comparar
// com o R$6 fixo da planilha.
// Rota de uso unico -- remover depois de confirmar os dados.
import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

async function chamarML(path: string, token: string) {
    try {
          const res = await fetch(`https://api.mercadolibre.com${path}`, {
                  headers: { Authorization: `Bearer ${token}` },
          });
          const text = await res.text();
          let data: unknown;
          try {
                  data = JSON.parse(text);
          } catch {
                  data = { raw: text.slice(0, 500) };
          }
          return { status: res.status, data };
    } catch (e) {
          return { status: 0, erro: String(e) };
    }
}

interface PedidoFlexRow {
    pedido_id: string;
    data_criado: string;
    total_amount: string;
    status: string;
}

export async function GET() {
    const auth = await getValidMLAccessToken();
    if (!auth) {
          return NextResponse.json({ ok: false, erro: "ML nao conectado" }, { status: 400 });
    }
    const { accessToken } = auth;
  
    const rows = (await sql`
        SELECT pedido_id, data_criado::text AS data_criado, total_amount, status
            FROM pedidos_cache
                WHERE plataforma = 'ml' AND shipping_mode = 'Flex'
                    ORDER BY data_criado DESC
                        LIMIT 8
                          `) as PedidoFlexRow[];
  
    const detalhes = [];
    for (const row of rows) {
          const order = await chamarML(`/orders/${row.pedido_id}`, accessToken);
          const orderData = order.data as any;
          const shippingId = orderData?.shipping?.id;
          let shipment: unknown = null;
         let shipmentCosts: unknown = null;
          if (shippingId) {
                  shipment = (await chamarML(`/shipments/${shippingId}`, accessToken)).data;
                  shipmentCosts = (await chamarML(`/shipments/${shippingId}/costs`, accessToken)).data;
          }
          detalhes.push({
                  pedidoId: row.pedido_id,
                  dataCriado: row.data_criado,
                  totalAmountCache: row.total_amount,
                  status: row.status,
                  totalAmountML: orderData?.total_amount,
                  payments: orderData?.payments?.map((p: any) => ({
                            total_paid_amount: p.total_paid_amount,
                            transaction_amount: p.transaction_amount,
                            marketplace_fee: p.marketplace_fee,
                            shipping_cost: p.shipping_cost,
                  })),
                  orderItems: orderData?.order_items?.map((oi: any) => ({
                            sale_fee: oi.sale_fee,
                            full_unit_price: oi.full_unit_price,
                            unit_price: oi.unit_price,
                            quantity: oi.quantity,
                  })),
                  shipment,
                  shipmentCosts,
          });
    }
  
    return NextResponse.json({ ok: true, totalPedidosFlex: rows.length, detalhes });
}
