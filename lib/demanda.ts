// Cálculo de demanda e recomendação de produção — atualizado em
// 2026-07-21 a pedido do usuário: em vez de usar só os últimos 7 dias
// (janela curta, ruidosa — muita placa ficava sem nenhuma venda
// detectada nela) e o multiplicador por Tier, agora:
//
// 1) A base de cálculo é o volume vendido num período maior (30 dias,
//    passado pela rota /api/producao/demanda), convertido pra uma
//    média semanal (qtyVendidaPeriodo / diasNoPeriodo × 7).
// 2) A meta de estoque é sempre "1 semana de venda no ritmo atual + 1
//    semana extra de reforço" — ou seja, 2× a média semanal — igual
//    pra todas as placas, sem distinção por Tier.
// 3) Vendas Full entram na mesma conta de "vendido" (produção serve
//    tanto pra reposição local quanto pra reposição do Full) — o
//    campo qtyVendidaFull é só informativo, não altera a meta.
//
// Simplificação assumida (v1, mantida): pra placas compostas
// (corpo+gancho), a venda de 1 unidade do produto final consome ~1
// peça de cada lado do par — aplicamos a mesma demanda a ambas as
// placas do grupo.
import { OrderSummary } from "./ml-orders";
import { PlacaRow } from "./placas";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function correspondeAoItem(placa: PlacaRow, tituloOuSku: string): boolean {
  const alvo = normalize(tituloOuSku);
  const nomePlaca = normalize(placa.skuOuKit);
  if (!alvo || !nomePlaca) return false;
  return alvo.includes(nomePlaca) || nomePlaca.includes(alvo);
}

export interface DemandaPlaca {
  placaId: number;
  // Total vendido no período usado como base de cálculo (ex: 30 dias) —
  // já inclui vendas Full, que contam pra mesma demanda de produção.
  qtyVendidaPeriodo: number;
  // Informativo apenas — quanto disso foi vendido no Full nos últimos 7
  // dias (pra você montar o envio de reposição de segunda-feira). Não
  // entra na conta de aProduzir.
  qtyVendidaFull: number;
  // Ritmo médio de venda por semana, derivado do período (qtyVendidaPeriodo
  // convertido pra uma janela de 7 dias).
  mediaSemanal: number;
  // Meta de estoque: 1 semana no ritmo atual + 1 semana extra de reforço.
  recomendadoEstoque: number;
  aProduzir: number;
}

// Mapeamento exato SKU → placa(s), vindo da tabela sku_placa (catálogo
// real de ~109 SKUs importado do Mercado Livre). Chave = normalize(sku).
// Uma mesma chave pode apontar pra mais de uma placa — caso das SKUs
// compostas (corpo + gancho), que credita venda nos dois lados do par.
export interface SkuPlacaEntry {
  placaId: number;
  pecasPorUnidade: number;
}
export type SkuPlacaMap = Map<string, SkuPlacaEntry[]>;

export function calcularDemandaSemanal(
  orders: OrderSummary[],
  placas: PlacaRow[],
  skuPlacaMap: SkuPlacaMap = new Map(),
  diasNoPeriodo: number = 7
): Map<number, DemandaPlaca> {
  const vendidoPorPlaca = new Map<number, number>();
  const vendidoFullPorPlaca = new Map<number, number>();

  const somar = (placaId: number, qty: number, isFull: boolean) => {
    vendidoPorPlaca.set(placaId, (vendidoPorPlaca.get(placaId) ?? 0) + qty);
    if (isFull) {
      vendidoFullPorPlaca.set(
        placaId,
        (vendidoFullPorPlaca.get(placaId) ?? 0) + qty
      );
    }
  };

  for (const order of orders) {
    const isFull = order.shippingMode === "Full";
    for (const item of order.items) {
      // 1) Casamento exato: SKU cadastrado no anúncio da ML bate com o
      // catálogo sku_placa. Tem prioridade sobre o texto — é preciso,
      // já lida com kits (pecas_por_unidade) e com pares corpo+gancho
      // sem duplicar nem perder venda por causa de variação de cor.
      let casouExato = false;
      if (item.hasCustomSku) {
        const entradas = skuPlacaMap.get(normalize(item.sku));
        if (entradas && entradas.length > 0) {
          casouExato = true;
          for (const entrada of entradas) {
            somar(
              entrada.placaId,
              item.quantity * entrada.pecasPorUnidade,
              isFull
            );
          }
        }
      }

      // 2) Fallback por texto (título do anúncio / sku_ou_kit da placa),
      // só usado quando não achou casamento exato — placa ainda não
      // cadastrada em sku_placa, ou pedido sem SKU customizado na ML.
      if (!casouExato) {
        for (const placa of placas) {
          if (
            correspondeAoItem(placa, item.title) ||
            (item.hasCustomSku && correspondeAoItem(placa, item.sku))
          ) {
            somar(placa.id, item.quantity, isFull);
          }
        }
      }
    }
  }

  const resultado = new Map<number, DemandaPlaca>();
  for (const placa of placas) {
    const qtyVendidaPeriodo = vendidoPorPlaca.get(placa.id) ?? 0;
    const qtyVendidaFull = vendidoFullPorPlaca.get(placa.id) ?? 0;
    const mediaSemanal = (qtyVendidaPeriodo / diasNoPeriodo) * 7;
    // Meta = 1 semana no ritmo atual + 1 semana extra de reforço (2x).
    const recomendadoEstoque = Math.ceil(mediaSemanal * 2);
    const aProduzir = Math.max(0, recomendadoEstoque - placa.estoque);
    resultado.set(placa.id, {
      placaId: placa.id,
      qtyVendidaPeriodo,
      qtyVendidaFull,
      mediaSemanal,
      recomendadoEstoque,
      aProduzir,
    });
  }

  return resultado;
}
