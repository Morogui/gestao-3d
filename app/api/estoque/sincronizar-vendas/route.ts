import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  getOrdersRange as getOrdersRangeML,
  pedidoFoiVendido,
  OrderSummary,
} from "@/lib/ml-orders";
import { getOrdersRange as getOrdersRangeShopee } from "@/lib/shopee-orders";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { resolverBaixaDoPedido, SkuPlacaMap } from "@/lib/demanda";
import { todaySP, diasAtras } from "@/lib/date";

export const dynamic = "force-dynamic";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Só olha pedidos CRIADOS nos últimos N dias — de propósito curto. Essa
// baixa automática está começando agora (pedido do Guilherme em
// 2026-07-22): não é um backfill de histórico. Se olhássemos meses pra
// trás, correríamos o risco de descontar de novo peças que ele já tirou
// manualmente do estoque na aba Estoque antes dessa automação existir.
// 10 dias é margem confortável pra pedidos que demoram alguns dias entre
// "criado" e "despachado" sem alcançar vendas antigas já contabilizadas.
const DIAS_JANELA = 10;

interface SincronizarResult {
  connected: boolean;
  pedidosVerificados?: number;
  combosNovos?: number;
  pecasBaixadas?: number;
  // Pedidos que já tinham dado baixa e deixaram de ser "vendido" (ex:
  // cancelado/estornado depois de pago) — a peça volta pro estoque
  // sozinha, sem precisar de ajuste manual.
  combosRevertidos?: number;
  pecasDevolvidas?: number;
  detalhes?: { plataforma: string; pedidoId: string; placaId: number; pecas: number }[];
}

export async function POST() {
  const hoje = todaySP();
  const inicio = diasAtras(hoje, DIAS_JANELA - 1);

  const [resultML, resultShopee] = await Promise.all([
    getOrdersRangeML(inicio, hoje),
    getOrdersRangeShopee(inicio, hoje),
  ]);

  if (!resultML.connected && !resultShopee.connected) {
    const resultado: SincronizarResult = { connected: false };
    return NextResponse.json(resultado);
  }

  const ordersML: OrderSummary[] =
    resultML.connected && !resultML.error ? resultML.orders : [];
  const ordersShopee: OrderSummary[] =
    resultShopee.connected && !resultShopee.error ? resultShopee.orders : [];
  const todosOsPedidos: OrderSummary[] = [...ordersML, ...ordersShopee];

  // Mesmo padrão de /api/producao/demanda e /api/estoque: SEM filtro de
  // descontinuada — um produto descontinuado ainda pode vender o que
  // sobrou em estoque, e essa venda também precisa dar baixa.
  const placaRows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
  `) as DbPlacaRow[];
  const placas = placaRows.map(toPlacaRow);

  const skuPlacaRows = (await sql`
    SELECT sku, placa_id, pecas_por_unidade FROM sku_placa
  `) as { sku: string; placa_id: number; pecas_por_unidade: string }[];
  const skuPlacaMap: SkuPlacaMap = new Map();
  for (const row of skuPlacaRows) {
    const chave = normalize(row.sku);
    const lista = skuPlacaMap.get(chave) ?? [];
    lista.push({
      placaId: row.placa_id,
      pecasPorUnidade: Number(row.pecas_por_unidade),
    });
    skuPlacaMap.set(chave, lista);
  }

  // Mudou em 2026-07-24: antes só considerava pedidos ENVIADOS. Agora a
  // baixa acontece assim que o pedido é "vendido" (pago) — ver
  // pedidoFoiVendido() em lib/ml-orders.ts pro motivo. Isso significa que
  // um pedido pode "desvender" numa sincronização futura (cancelado,
  // estornado) — pra esses, devolvemos a peça pro estoque em vez de só
  // ignorar, senão a peça ficaria descontada pra sempre por uma venda que
  // não se concretizou.
  let combosNovos = 0;
  let pecasBaixadas = 0;
  let combosRevertidos = 0;
  let pecasDevolvidas = 0;
  const detalhes: SincronizarResult["detalhes"] = [];
  const pedidosVendidos = todosOsPedidos.filter(pedidoFoiVendido);

  for (const pedido of todosOsPedidos) {
    const vendido = pedidoFoiVendido(pedido);

    if (vendido) {
      const baixas = resolverBaixaDoPedido(pedido, placas, skuPlacaMap);
      for (const { placaId, pecas } of baixas) {
        if (pecas <= 0) continue;

        // INSERT ... ON CONFLICT DO NOTHING é o que garante idempotência:
        // só se a linha for realmente inserida (pedido+placa ainda não
        // processado antes) é que aplicamos o desconto no estoque —
        // rodar essa sincronização várias vezes (ex: toda vez que a aba
        // Estoque é aberta) nunca desconta a mesma venda duas vezes.
        const inseridos = (await sql`
          INSERT INTO baixas_estoque_vendas (plataforma, pedido_id, placa_id, pecas)
          VALUES (${pedido.plataforma}, ${String(pedido.id)}, ${placaId}, ${pecas})
          ON CONFLICT (plataforma, pedido_id, placa_id) DO NOTHING
          RETURNING id
        `) as { id: number }[];

        if (inseridos.length > 0) {
          await sql`
            UPDATE estoque_placas
            SET quantidade_pecas = GREATEST(0, quantidade_pecas - ${pecas}), atualizado_em = now()
            WHERE placa_id = ${placaId}
          `;
          combosNovos += 1;
          pecasBaixadas += pecas;
          detalhes.push({
            plataforma: pedido.plataforma,
            pedidoId: String(pedido.id),
            placaId,
            pecas,
          });
        }
      }
    } else {
      // Pedido não (mais) vendido — se alguma sincronização anterior já
      // tinha dado baixa nele (era pago, agora foi cancelado/estornado),
      // devolve a peça e apaga o registro, pra ele poder ser processado
      // de novo caso volte a ficar vendido no futuro (raro, mas o ON
      // CONFLICT DO NOTHING acima depende de a linha não existir mais).
      const existentes = (await sql`
        SELECT id, placa_id, pecas FROM baixas_estoque_vendas
        WHERE plataforma = ${pedido.plataforma} AND pedido_id = ${String(pedido.id)}
      `) as { id: number; placa_id: number; pecas: number }[];

      for (const row of existentes) {
        await sql`
          UPDATE estoque_placas
          SET quantidade_pecas = quantidade_pecas + ${row.pecas}, atualizado_em = now()
          WHERE placa_id = ${row.placa_id}
        `;
        await sql`DELETE FROM baixas_estoque_vendas WHERE id = ${row.id}`;
        combosRevertidos += 1;
        pecasDevolvidas += row.pecas;
      }
    }
  }

  const resultado: SincronizarResult = {
    connected: true,
    pedidosVerificados: pedidosVendidos.length,
    combosNovos,
    pecasBaixadas,
    combosRevertidos,
    pecasDevolvidas,
    detalhes: detalhes.slice(0, 20),
  };
  return NextResponse.json(resultado);
}
