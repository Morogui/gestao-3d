// Cálculo de demanda semanal e recomendação de produção por Tier —
// lógica descrita em docs/logica-producao-placas.md, seção 5.
//
// Tier A (top 20% de velocidade de venda semanal): produzir 2.0x a
// demanda semanal. Tier B (próximos 30%): 1.3x. Tier C (resto): 1.0x.
//
// Simplificação assumida (v1): pra placas compostas (corpo+gancho), a
// venda de 1 unidade do produto final consome ~1 peça de cada lado do
// par — aplicamos a mesma demanda semanal a ambas as placas do grupo.
// Isso é uma aproximação; se a proporção real corpo:gancho de um
// produto específico não for 1:1, ajuste a quantidade "a produzir" na
// hora de carregar a placa.
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

const TIER_MULTIPLIER: Record<PlacaRow["tier"], number> = {
  A: 2.0,
  B: 1.3,
  C: 1.0,
};

export interface DemandaPlaca {
  placaId: number;
  qtyVendidaSemana: number;
  qtyVendidaFull: number;
  recomendadoSemanal: number;
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
  skuPlacaMap: SkuPlacaMap = new Map()
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
    const qtyVendidaSemana = vendidoPorPlaca.get(placa.id) ?? 0;
    const qtyVendidaFull = vendidoFullPorPlaca.get(placa.id) ?? 0;
    const recomendadoSemanal = Math.ceil(
      qtyVendidaSemana * TIER_MULTIPLIER[placa.tier]
    );
    const aProduzir = Math.max(0, recomendadoSemanal - placa.estoque);
    resultado.set(placa.id, {
      placaId: placa.id,
      qtyVendidaSemana,
      qtyVendidaFull,
      recomendadoSemanal,
      aProduzir,
    });
  }

  return resultado;
}
