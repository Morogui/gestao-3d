import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getOrdersRange as getOrdersRangeML, OrderSummary } from "@/lib/ml-orders";
import { getOrdersRange as getOrdersRangeShopee } from "@/lib/shopee-orders";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { calcularDemandaSemanal, SkuPlacaMap } from "@/lib/demanda";
import { todaySP } from "@/lib/date";

// Mesma normalização usada em lib/demanda.ts pra chave do mapa (minúsculo,
// sem acento, sem pontuação) — precisa bater exatamente com a chave usada
// na hora de consultar o mapa lá dentro.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const dynamic = "force-dynamic";

const DIAS_BASE = 30;

// Demanda (base: últimos 30 dias, incluindo hoje) por placa, com meta de
// estoque de "1 semana no ritmo atual + 1 semana de reforço" — ver
// lib/demanda.ts pra detalhes da mudança de fórmula (2026-07-21). Usada
// pela aba Produção pra sugerir o que carregar nas máquinas.
export async function GET() {
  const hoje = todaySP();
  const inicioBaseDate = new Date(`${hoje}T12:00:00-03:00`);
  inicioBaseDate.setDate(inicioBaseDate.getDate() - (DIAS_BASE - 1));
  const inicio = inicioBaseDate.toISOString().slice(0, 10);

  const seteDiasAtrasDate = new Date(`${hoje}T12:00:00-03:00`);
  seteDiasAtrasDate.setDate(seteDiasAtrasDate.getDate() - 6);

  // Busca ML + Shopee em paralelo e mescla os pedidos antes de calcular a
  // demanda — antes desse fix, a produção só enxergava vendas da ML, então
  // qualquer SKU vendido também na Shopee tinha sua meta de estoque/"a
  // produzir" subestimada (a Shopee ficava invisível pro cálculo). ML
  // continua sendo obrigatória pra essa tela funcionar (é a conexão
  // principal, testada há mais tempo); Shopee entra "de bônus" quando
  // conectada — se não estiver, a demanda cai de volta pro que já
  // funcionava (só ML), sem quebrar a tela.
  const [result, resultShopee] = await Promise.all([
    getOrdersRangeML(inicio, hoje),
    getOrdersRangeShopee(inicio, hoje),
  ]);

  if (!result.connected) {
    return NextResponse.json({ connected: false });
  }
  if (result.error) {
    return NextResponse.json({ connected: true, error: true });
  }

  const shopeeOrders: OrderSummary[] =
    resultShopee.connected && !resultShopee.error ? resultShopee.orders : [];
  const shopeeConectada = resultShopee.connected && !resultShopee.error;
  const todosOsPedidos: OrderSummary[] = [...result.orders, ...shopeeOrders];

  // IMPORTANTE: inclui placas descontinuadas aqui (sem WHERE
  // descontinuada = false) — senão as vendas de um produto descontinuado
  // (ex: Taça Copa do Mundo, que só vende o estoque que sobrou) nunca
  // batem com nada e ficam presas pra sempre no relatório de "não
  // identificado", mesmo com o texto do anúncio corretamente cadastrado
  // em sku_ou_kit. A tela de Produção (fila de prioridade, formulário de
  // carregar máquina etc.) continua só mostrando as não-descontinuadas
  // porque busca a lista separadamente em /api/placas (que mantém esse
  // filtro) — aqui é só pra fins de casamento venda↔placa.
  const placaRows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    ORDER BY p.numero ASC
  `) as DbPlacaRow[];

  const placas = placaRows.map(toPlacaRow);

  // Catálogo exato SKU → placa (importado da planilha de SKUs reais),
  // usado como 1ª tentativa de casamento venda↔placa antes do fallback
  // por texto (ver lib/demanda.ts).
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

  // Itens que o Guilherme já marcou como "não precisa aparecer" no
  // aviso de vendas não identificadas (produto descontinuado, anúncio
  // que nunca vai ganhar uma placa própria etc.) — ver
  // POST /api/producao/ignorar-item.
  const ignoradosRows = (await sql`
    SELECT chave FROM itens_demanda_ignorados
  `) as { chave: string }[];
  const ignorados = new Set(ignoradosRows.map((r) => r.chave));

  // Base de 30 dias — define o ritmo semanal e a meta de estoque (ver
  // lib/demanda.ts). aProduzir e recomendadoEstoque vêm daqui. Usa
  // todosOsPedidos (ML + Shopee mesclados) pra não subestimar a demanda
  // real de quem vende nas duas plataformas.
  const { porPlaca: demandaBase, naoIdentificado } = calcularDemandaSemanal(
    todosOsPedidos,
    placas,
    skuPlacaMap,
    DIAS_BASE,
    ignorados
  );

  // Só pra alimentar o "Vendido no Full (semana)" — reaproveita os
  // pedidos já buscados (sem nova chamada à ML), filtrando pros últimos
  // 7 dias. Não altera aProduzir/recomendadoEstoque.
  const orders7d = todosOsPedidos.filter(
    (o) => new Date(o.dateCreated) >= seteDiasAtrasDate
  );
  const { porPlaca: demandaSemana, naoIdentificado: naoIdentificadoSemana } =
    calcularDemandaSemanal(orders7d, placas, skuPlacaMap, 7, ignorados);

  const demandaFinal = placas.map((placa) => {
    const base = demandaBase.get(placa.id)!;
    const semana = demandaSemana.get(placa.id);
    return { ...base, qtyVendidaFull: semana?.qtyVendidaFull ?? 0 };
  });

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio, fim: hoje },
    totalPedidos: todosOsPedidos.length,
    // Se a Shopee não estiver conectada (ou a sessão expirou), a demanda
    // segue calculada só com ML — isso avisa a tela que o número está
    // parcial, sem travar a página inteira por causa da Shopee.
    shopeeConectada,
    demanda: demandaFinal,
    // Vendas (30 dias) que não bateram com nenhuma placa do catálogo —
    // produto ainda não cadastrado em Produção ou SKU sem
    // correspondência. qtyFull aqui é sobre os 30 dias; naoIdentificadoSemana
    // é a mesma conta só pros últimos 7 dias (compatível com o card de
    // Full da semana).
    naoIdentificado,
    naoIdentificadoSemana,
  });
}
