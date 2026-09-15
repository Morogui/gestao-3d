import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { ML_API_BASE } from "@/lib/mercadolivre";

// Rota de diagnostico TEMPORARIA -- pedido do Guilherme em 2026-09-15:
// "Veja se voce consegue puxar algum relatorio do custo dos envios dos
// meus produtos que foram vendidos no full, ou puxar de fato quanto
// eles cobram de envio, precisamos disso para precificar".
//
// Usa a API de Relatorios de Faturamento da ML (billing/integration) pra
// puxar as cobrancas reais de Fulfillment (Full) do periodo mais recente
// fechado, incluindo o tipo WAREHOUSING (armazenagem) -- que hoje esta
// hardcoded como R$0 em armazenagemFullML (config de precificacao).
// Documentacao: developers.mercadolivre.com.br/pt_br/relatorios-de-faturamento
//
// Remover esta rota depois de extrair o valor real.
export async function GET() {
    const auth = await getValidMLAccessToken();
    if (!auth) {
          return NextResponse.json({ erro: "ML nao conectado" }, { status: 401 });
    }
    const headers = { Authorization: `Bearer ${auth.accessToken}` };

  const periodosResp = await fetch(
        `${ML_API_BASE}/billing/integration/periods?group=ML&document_type=BILL&limit=6`,
    { headers, cache: "no-store" }
      );
    const periodosBody = await periodosResp.text();
    if (!periodosResp.ok) {
          return NextResponse.json(
            { erro: "Falha ao buscar periodos", status: periodosResp.status, body: periodosBody },
            { status: 502 }
                );
    }
    const periodos = JSON.parse(periodosBody);

  const results = periodos.results ?? [];
    const chaves: string[] = results
      .filter((p: any) => p.period_status === "CLOSED" || p.key)
      .slice(0, 3)
      .map((p: any) => p.key)
      .filter(Boolean);

  const todasCobrancas: any[] = [];
    const errosPorPeriodo: any[] = [];

  for (const key of chaves) {
        const detailsResp = await fetch(
                `${ML_API_BASE}/billing/integration/periods/key/${key}/group/ML/full/details?document_type=BILL&limit=1000`,
          { headers, cache: "no-store" }
              );
        const detailsText = await detailsResp.text();
        if (!detailsResp.ok) {
                errosPorPeriodo.push({ key, status: detailsResp.status, body: detailsText.slice(0, 500) });
                continue;
        }
        try {
                const detailsJson = JSON.parse(detailsText);
                const items = (detailsJson.results ?? []).map((r: any) => ({ ...r, __periodo: key }));
                todasCobrancas.push(...items);
        } catch {
                errosPorPeriodo.push({ key, parseError: true, sample: detailsText.slice(0, 300) });
        }
  }

  const porTipo: Record<string, { count: number; total: number; amostras: any[] }> = {};
    for (const c of todasCobrancas) {
          const tipo = c.fulfillment_info?.type ?? "SEM_TIPO";
          if (!porTipo[tipo]) porTipo[tipo] = { count: 0, total: 0, amostras: [] };
          porTipo[tipo].count++;
          porTipo[tipo].total += Number(c.charge_info?.detail_amount ?? 0);
          if (porTipo[tipo].amostras.length < 3) {
                  porTipo[tipo].amostras.push({
                            item_id: c.fulfillment_info?.item_id,
                            sku: c.fulfillment_info?.sku,
                            item_title: c.fulfillment_info?.item_title,
                            amount: c.fulfillment_info?.amount,
                            amount_per_unit: c.fulfillment_info?.amount_per_unit,
                            detail_amount: c.charge_info?.detail_amount,
                            transaction_detail: c.charge_info?.transaction_detail,
                            size: c.fulfillment_info?.size,
                            item_quantity: c.fulfillment_info?.item_quantity,
                            periodo: c.__periodo,
                  });
          }
    }

  return NextResponse.json({
        periodosDisponiveis: results.map((p: any) => ({ key: p.key, status: p.period_status, de: p.period?.date_from, ate: p.period?.date_to })),
        chavesConsultadas: chaves,
        errosPorPeriodo,
        totalCobrancasFull: todasCobrancas.length,
        porTipo,
  });
}
