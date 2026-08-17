// Cálculo de demanda e recomendação de produção — atualizado em
// 2026-07-21 a pedido do usuário: em vez de usar só os últimos 7 dias
// (janela curta, ruidosa — muita placa ficava sem nenhuma venda
// detectada nela) e o multiplicador por Tier, agora:
//
// 1) A base de cálculo é o volume vendido num período maior (30 dias,
//    passado pela rota /api/producao/demanda), convertido pra uma
//    média semanal (qtyVendidaPeriodo / diasNoPeriodo × 7).
// 2) Meta de estoque — mudou em 2026-07-24 (pedido do Guilherme): "o
//    estoque que precisamos criar é de 1 mês de venda do produto...
//    sempre use como base a quantidade vendida do produto no mês
//    anterior x1.3". Ou seja, meta = venda estimada de 30 dias × 1.3 —
//    igual pra todas as placas, sem distinção por Tier. Antes era 2
//    semanas (1 semana no ritmo atual + 1 de reforço); a meta mais que
//    dobrou.
// 3) Vendas Full entram na mesma conta de "vendido" (produção serve
//    tanto pra reposição local quanto pra reposição do Full) — o
//    campo qtyVendidaFull é só informativo, não altera a meta.
//
// Simplificação assumida (v1, mantida): pra placas compostas
// (corpo+gancho), a venda de 1 unidade do produto final consome ~1
// peça de cada lado do par — aplicamos a mesma demanda a ambas as
// placas do grupo.
import { OrderSummary, pedidoFoiVendido } from "./ml-orders";
import { PlacaRow } from "./placas";

const DESPACHADO = new Set([
  "shipped",
  "delivered",
  "completed",
  "to_confirm_receive",
  ]);

export function statusIndicaDespachado(
  shippingStatus: string | null | undefined
  ): boolean {
  return DESPACHADO.has((shippingStatus || "").toLowerCase());
}

function pedidoAindaNaoDespachado(order: OrderSummary): boolean {
  return !statusIndicaDespachado(order.shippingStatus);
}

function normalize(s: string): string {
  return s
  .toLowerCase()
  .normalize("NFD")
  .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
}

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "com", "sem", "para", "pra", "um",
  "uma", "uns", "umas", "no", "na", "nos", "nas", "os", "as", "por", "em",
  "a", "o",
  ]);

function palavrasSignificativas(s: string): string[] {
  return normalize(s)
  .split(" ")
  .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function textoCorresponde(referencia: string, tituloOuSku: string): boolean {
  const alvo = normalize(tituloOuSku);
  if (!alvo) return false;

const frases = referencia
  .split("|")
  .map((f) => f.trim())
  .filter(Boolean);

return frases.some((frase) => {
  const ref = normalize(frase);
  if (!ref) return false;
  if (alvo.includes(ref) || ref.includes(alvo)) return true;

                   const palavrasRef = palavrasSignificativas(frase);
  if (palavrasRef.length === 0) return false;
  const tokensAlvoArr = alvo.split(" ");
  const tokensAlvo = new Set(tokensAlvoArr);
  if (!palavrasRef.every((p) => tokensAlvo.has(p))) return false;

                   const palavrasAlvoSignificativas = new Set(
                     tokensAlvoArr.filter((w) => w.length >= 3 && !STOPWORDS.has(w))
                     );
  if (palavrasRef.length / palavrasAlvoSignificativas.size < 0.4) {
    return false;
  }

                   return true;
});
}

const CORES_CONHECIDAS = [
  "branco", "preto", "preta", "cinza", "marrom", "prata", "bege", "laranja",
  ];

function corDoTexto(texto: string): string | null {
  const tokensNaOrdem = normalize(texto).split(" ");
  const coresConhecidas = new Set(CORES_CONHECIDAS);
  let ultima: string | null = null;
  for (const tok of tokensNaOrdem) {
    if (coresConhecidas.has(tok)) {
      ultima = tok === "preta" ? "preto" : tok;
    }
  }
  return ultima;
}

export function correspondeAoItem(placa: PlacaRow, tituloOuSku: string): boolean {
  const bateu =
    textoCorresponde(placa.skuOuKit, tituloOuSku) ||
    textoCorresponde(placa.nome, tituloOuSku) ||
    (placa.frasesCorrespondencia
     ? textoCorresponde(placa.frasesCorrespondencia, tituloOuSku)
     : false);
  if (!bateu) return false;

const corPlaca = corDoTexto(placa.nome);
  const corTexto = corDoTexto(tituloOuSku);
  if (corPlaca && corTexto && corPlaca !== corTexto) return false;

return true;
}

// Casamento exato por item_id da ML (MLBxxxxx) — critério de PRIORIDADE
// MÁXIMA, antes até do SKU. Adicionado em 2026-08-10 depois de um bug
// real reportado pelo Guilherme: vários anúncios com título genérico
// batiam por texto em 2-3 placas erradas ao mesmo tempo (ex: "Suporte
// Organizador Universal Parede Para Secador De Cabelo Preto" casava com
// a placa certa do Secador MAS TAMBÉM com "Suporte Universal - Mista
// (Preto)" e "Gancho Compartilhado (Preto)", só porque as palavras
// genéricas "suporte", "universal" e "preto" apareciam nos dois textos
// por coincidência — produto completamente diferente). O item_id é o
// único identificador SEMPRE único e estável por anúncio real, ao
// contrário do SKU (campo opcional, o vendedor pode nem preencher) e do
// título (texto livre, sujeito a colisão de palavras). Reaproveita a
// MESMA tabela sku_placa — um item_id registrado lá funciona como um
// SKU exato, incluindo o multiplicador pecas_por_unidade pra kits.
// Combinado com o Guilherme em 2026-08-10: pra produção o nome/parafuso
// do anúncio não importa (a peça impressa é a mesma, o parafuso é só um
// item de embalagem separado) — o que precisa ser preciso é ESSE
// casamento item→placa, pra cada anúncio real apontar pra exatamente 1
// placa (nome principal), nunca mais de uma por engano.
function idPorItemId(
  itemId: string | undefined,
  skuPlacaMap: SkuPlacaMap
  ): SkuPlacaEntry[] | undefined {
  if (!itemId || itemId === "—") return undefined;
  return skuPlacaMap.get(normalize(itemId));
}

export function matchItemToPlacaIds(
  item: { itemId?: string; sku: string; hasCustomSku: boolean; title: string },
  placas: PlacaRow[],
  skuPlacaMap: SkuPlacaMap
  ): number[] {
  const porItemId = idPorItemId(item.itemId, skuPlacaMap);
  if (porItemId && porItemId.length > 0) {
    return porItemId.map((e) => e.placaId);
  }

if (item.hasCustomSku) {
  const entradas = skuPlacaMap.get(normalize(item.sku));
  if (entradas && entradas.length > 0) {
    return entradas.map((e) => e.placaId);
  }
}

const ids: number[] = [];
  for (const placa of placas) {
    if (
      correspondeAoItem(placa, item.title) ||
      (item.hasCustomSku && correspondeAoItem(placa, item.sku))
      ) {
      ids.push(placa.id);
    }
  }
  return ids;
}

export interface DemandaPlaca {
  placaId: number;
  qtyVendidaPeriodo: number;
  qtyVendidaFull: number;
  mediaSemanal: number;
  recomendadoEstoque: number;
  aProduzir: number;
  ultimaVendaEm: string | null;
  pecasPendentesDespacho: number;
}

// Mapeamento exato SKU → placa(s), vindo da tabela sku_placa. Chave =
// normalize(sku). Uma mesma chave pode apontar pra mais de uma placa —
// caso das SKUs compostas (corpo + gancho). Desde 2026-08-10 essa mesma
// tabela/mapa também guarda entradas com chave = normalize(item_id da
// ML) — ver idPorItemId acima — pra anúncios cujo título é ambíguo
// demais pra confiar no texto.
export interface SkuPlacaEntry {
  placaId: number;
  pecasPorUnidade: number;
}
export type SkuPlacaMap = Map<string, SkuPlacaEntry[]>;

export interface NaoIdentificado {
  qtyPeriodo: number;
  qtyFull: number;
  amostras: {
  titulo: string;
  sku: string;
  quantity: number;
  isFull: boolean;
  itemId: string;
  }[];
}

export interface ResultadoDemanda {
  porPlaca: Map<number, DemandaPlaca>;
  naoIdentificado: NaoIdentificado;
}

export function chaveItemIgnorado(sku: string, titulo: string): string {
  return normalize(sku) || normalize(titulo);
}

export interface BaixaItem {
  placaId: number;
  pecas: number;
}

export function resolverBaixaDoPedido(
  order: OrderSummary,
  placas: PlacaRow[],
  skuPlacaMap: SkuPlacaMap
  ): BaixaItem[] {
  const porPlaca = new Map<number, number>();
  const somar = (placaId: number, qty: number) => {
    porPlaca.set(placaId, (porPlaca.get(placaId) ?? 0) + qty);
  };

for (const item of order.items) {
  let casou = false;

  const porItemId = idPorItemId(item.itemId, skuPlacaMap);
  if (porItemId && porItemId.length > 0) {
    casou = true;
    for (const entrada of porItemId) {
      somar(entrada.placaId, item.quantity * entrada.pecasPorUnidade);
    }
  }

  if (!casou && item.hasCustomSku) {
    const entradas = skuPlacaMap.get(normalize(item.sku));
    if (entradas && entradas.length > 0) {
      casou = true;
      for (const entrada of entradas) {
        somar(entrada.placaId, item.quantity * entrada.pecasPorUnidade);
      }
    }
  }

  if (!casou) {
    for (const placa of placas) {
      if (
        correspondeAoItem(placa, item.title) ||
        (item.hasCustomSku && correspondeAoItem(placa, item.sku))
        ) {
        somar(placa.id, item.quantity);
      }
    }
  }
}

return Array.from(porPlaca.entries()).map(([placaId, pecas]) => ({
  placaId,
  pecas,
}));
}

export function calcularDemandaSemanal(
  orders: OrderSummary[],
  placas: PlacaRow[],
  skuPlacaMap: SkuPlacaMap = new Map(),
  diasNoPeriodo: number = 7,
  ignorados: Set<string> = new Set()
  ): ResultadoDemanda {
  const vendidoPorPlaca = new Map<number, number>();
  const vendidoFullPorPlaca = new Map<number, number>();
  const ultimaVendaPorPlaca = new Map<number, string>();
  const pendenteDespachoPorPlaca = new Map<number, number>();
  const naoIdentificado: NaoIdentificado = {
    qtyPeriodo: 0,
    qtyFull: 0,
    amostras: [],
  };

const somar = (
  placaId: number,
  qty: number,
  isFull: boolean,
  dataCriacao: string,
  pendenteDespacho: boolean
  ) => {
    vendidoPorPlaca.set(placaId, (vendidoPorPlaca.get(placaId) ?? 0) + qty);
    if (isFull) {
      vendidoFullPorPlaca.set(
        placaId,
        (vendidoFullPorPlaca.get(placaId) ?? 0) + qty
        );
    }
    const atual = ultimaVendaPorPlaca.get(placaId);
    if (!atual || dataCriacao > atual) {
      ultimaVendaPorPlaca.set(placaId, dataCriacao);
    }
    if (pendenteDespacho) {
      pendenteDespachoPorPlaca.set(
        placaId,
        (pendenteDespachoPorPlaca.get(placaId) ?? 0) + qty
        );
    }
  };

for (const order of orders) {
  const isFull = order.shippingMode === "Full";
  const pendenteDespacho =
    pedidoFoiVendido(order) && pedidoAindaNaoDespachado(order);
  for (const item of order.items) {
    let casou = false;

  const porItemId = idPorItemId(item.itemId, skuPlacaMap);
    if (porItemId && porItemId.length > 0) {
      casou = true;
      for (const entrada of porItemId) {
        somar(
          entrada.placaId,
          item.quantity * entrada.pecasPorUnidade,
          isFull,
          order.dateCreated,
          pendenteDespacho
          );
      }
    }

  if (!casou && item.hasCustomSku) {
    const entradas = skuPlacaMap.get(normalize(item.sku));
    if (entradas && entradas.length > 0) {
      casou = true;
      for (const entrada of entradas) {
        somar(
          entrada.placaId,
          item.quantity * entrada.pecasPorUnidade,
          isFull,
          order.dateCreated,
          pendenteDespacho
          );
      }
    }
  }

  if (!casou) {
    for (const placa of placas) {
      if (
        correspondeAoItem(placa, item.title) ||
        (item.hasCustomSku && correspondeAoItem(placa, item.sku))
        ) {
        casou = true;
        somar(
          placa.id,
          item.quantity,
          isFull,
          order.dateCreated,
          pendenteDespacho
          );
      }
    }
  }

  if (!casou) {
    const chave = chaveItemIgnorado(
      item.hasCustomSku ? item.sku : "",
      item.title
      );
    if (!ignorados.has(chave)) {
      naoIdentificado.qtyPeriodo += item.quantity;
      if (isFull) naoIdentificado.qtyFull += item.quantity;
      if (naoIdentificado.amostras.length < 20) {
        naoIdentificado.amostras.push({
          titulo: item.title,
          sku: item.hasCustomSku ? item.sku : "",
          quantity: item.quantity,
          isFull,
          itemId: item.itemId,
        });
      }
    }
  }
  }
}

const porPlaca = new Map<number, DemandaPlaca>();
  for (const placa of placas) {
    const qtyVendidaPeriodo = vendidoPorPlaca.get(placa.id) ?? 0;
    const qtyVendidaFull = vendidoFullPorPlaca.get(placa.id) ?? 0;
    const mediaSemanal = (qtyVendidaPeriodo / diasNoPeriodo) * 7;
    const mediaMensal = (qtyVendidaPeriodo / diasNoPeriodo) * 30;
    const recomendadoEstoque = Math.ceil(mediaMensal * 1.3);
    const aProduzir = placa.descontinuada
    ? 0
      : Math.max(0, recomendadoEstoque - placa.estoque);
    porPlaca.set(placa.id, {
      placaId: placa.id,
      qtyVendidaPeriodo,
      qtyVendidaFull,
      mediaSemanal,
      recomendadoEstoque,
      aProduzir,
      ultimaVendaEm: ultimaVendaPorPlaca.get(placa.id) ?? null,
      pecasPendentesDespacho: pendenteDespachoPorPlaca.get(placa.id) ?? 0,
    });
  }

return { porPlaca, naoIdentificado };
}
