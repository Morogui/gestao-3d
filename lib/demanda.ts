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

export function calcularDemandaSemanal(
  orders: OrderSummary[],
  placas: PlacaRow[]
): Map<number, DemandaPlaca> {
  const vendidoPorPlaca = new Map<number, number>();
  const vendidoFullPorPlaca = new Map<number, number>();

  for (const order of orders) {
    const isFull = order.shippingMode === "Full";
    for (const item of order.items) {
      for (const placa of placas) {
        if (
          correspondeAoItem(placa, item.title) ||
          (item.hasCustomSku && correspondeAoItem(placa, item.sku))
        ) {
          vendidoPorPlaca.set(
            placa.id,
            (vendidoPorPlaca.get(placa.id) ?? 0) + item.quantity
          );
          if (isFull) {
            vendidoFullPorPlaca.set(
              placa.id,
              (vendidoFullPorPlaca.get(placa.id) ?? 0) + item.quantity
            );
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
