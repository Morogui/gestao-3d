import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// touch
// Rota de diagnóstico TEMPORÁRIA (2026-08-08) — pra descobrir o formato
// real que a ML devolve pra pedidos de anúncios com variação (ex:
// Cortina Com/Sem Parafuso), já que o código atual (lib/ml-orders.ts)
// só lê item.id/title/seller_custom_field e as duas variações vêm
// idênticas pro resto do sistema. Devolve o JSON cru de order_items dos
// últimos 14 dias, sem nenhum processamento, pra inspecionar campos
// como variation_id/variation_attributes. Remover depois de usar.
export async function GET() {
  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;

  if (!accessToken || !userId) {
    return NextResponse.json({ connected: false });
  }

  const hoje = new Date();
  const dataAtras = new Date(hoje.getTime() - 14 * 24 * 60 * 60 * 1000);
  const dateFrom = dataAtras.toISOString();
  const dateTo = hoje.toISOString();

  const resp = await fetch(
    `${ML_API_BASE}/orders/search?seller=${userId}&sort=date_desc&limit=50` +
      `&order.date_created.from=${encodeURIComponent(dateFrom)}` +
      `&order.date_created.to=${encodeURIComponent(dateTo)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );

  if (!resp.ok) {
    return NextResponse.json({ error: true, status: resp.status }, { status: 500 });
  }

  const data = await resp.json();
  const results = data.results ?? [];

  // Só devolve os order_items crus (título + tudo mais que a ML mandar)
  // de pedidos cujo título tenha "cortina" — foco no caso que estamos
  // investigando, sem despejar o payload inteiro de todos os pedidos.
  const relevantes = results
    .map((o: any) => ({ orderId: o.id, dateCreated: o.date_created, order_items: o.order_items }))
    .filter((o: any) =>
      (o.order_items ?? []).some((oi: any) =>
        (oi.item?.title ?? "").toLowerCase().includes("cortina")
      )
    );

  return NextResponse.json({
    totalPedidos: results.length,
    pedidosComCortina: relevantes.length,
    amostra: relevantes.slice(0, 5),
  });
}
