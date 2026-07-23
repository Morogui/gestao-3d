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

// Palavras curtas/de ligação que não ajudam a identificar o produto — se
// entrassem na comparação por token, dariam falso positivo fácil demais
// (ex: "de" aparece em quase todo título de anúncio).
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

// Testa se o texto de referência da placa (SKU/kit interno ou nome
// comercial) "aparece" no título/SKU do pedido. Duas estratégias, da mais
// pra menos estrita:
// 1) Substring literal (rápido, sem falso positivo, mas exige que o
//    texto apareça na mesma ordem/forma — funciona bem pra SKUs internos).
// 2) Todas as palavras significativas do texto de referência aparecem
//    como token inteiro em algum lugar do título (mais tolerante a
//    reordenação/marketing do anúncio, ex: "Suporte Universal" batendo em
//    "Suporte Universal Multiuso Organizador Parede Branco").
// Aceita várias frases alternativas dentro do mesmo campo, separadas por
// "|" — útil quando o mesmo produto aparece em anúncios com títulos bem
// diferentes do nome/SKU interno (ex: um SKU "GPAN BRANCO" mas o anúncio
// da ML se chama "Kit Gancho Para Box Vidro..."). Basta UMA das frases
// bater (substring ou todas as palavras significativas presentes) pra
// considerar correspondência.
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
    const tokensAlvo = new Set(alvo.split(" "));
    return palavrasRef.every((p) => tokensAlvo.has(p));
  });
}

// Guarda de cor — bug real encontrado em 2026-07-22: um anúncio "...
// Branco" estava contando (via casamento por texto/palavras) tanto pra
// placa Preto quanto pra placa Branco, porque "com"/"sem" são stopwords
// e o resto das palavras batia nas duas. Regra combinada com o usuário:
// anúncio de placa branca só conta pro branco, anúncio de placa preta só
// conta pro preto. Detecta a cor pelo NOME da placa (convenção "(Cor)" já
// usada em todo o catálogo) e pelo próprio texto do anúncio — só bloqueia
// quando os dois têm cor explícita E são diferentes; textos sem cor
// mencionada (ex: anúncio genérico "Sem Parafusos") continuam batendo
// normalmente, sem essa restrição.
const CORES_CONHECIDAS = [
  "branco", "preto", "preta", "cinza", "marrom", "prata", "bege", "laranja",
];
function corDoTexto(texto: string): string | null {
  const tokens = new Set(normalize(texto).split(" "));
  for (const cor of CORES_CONHECIDAS) {
    if (tokens.has(cor)) return cor === "preta" ? "preto" : cor;
  }
  return null;
}

function correspondeAoItem(placa: PlacaRow, tituloOuSku: string): boolean {
  const bateu =
    textoCorresponde(placa.skuOuKit, tituloOuSku) ||
    textoCorresponde(placa.nome, tituloOuSku);
  if (!bateu) return false;

  const corPlaca = corDoTexto(placa.nome);
  const corTexto = corDoTexto(tituloOuSku);
  if (corPlaca && corTexto && corPlaca !== corTexto) return false;

  return true;
}

// Mesma lógica de casamento usada dentro de calcularDemandaSemanal (SKU
// exato via sku_placa, senão texto do título/SKU vs. catálogo), exposta
// separadamente pra quem precisa saber A QUAL(IS) placa(s) um item
// específico pertence — usado pela aba Full pra descobrir o item_id da
// ML de cada placa e então consultar o estoque real no Full via API.
export function matchItemToPlacaIds(
  item: { sku: string; hasCustomSku: boolean; title: string },
  placas: PlacaRow[],
  skuPlacaMap: SkuPlacaMap
): number[] {
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

// Itens vendidos que não bateram com nenhuma placa do catálogo (nem por
// SKU exato, nem por texto) — ou porque o produto ainda não está
// cadastrado em Produção, ou porque o SKU customizado do anúncio não
// bate com o catálogo. Serve pra deixar visível o quanto de venda está
// "invisível" pro cálculo de demanda, em vez de sumir silenciosamente.
export interface NaoIdentificado {
  qtyPeriodo: number;
  qtyFull: number;
  amostras: { titulo: string; sku: string; quantity: number; isFull: boolean }[];
}

export interface ResultadoDemanda {
  porPlaca: Map<number, DemandaPlaca>;
  naoIdentificado: NaoIdentificado;
}

// Chave usada pra "silenciar" um item que nunca vai bater com o
// catálogo (ex: anúncio de um produto que a Multiplique/Morolar não
// vende mais) — SKU tem prioridade sobre o título por ser mais estável
// entre pedidos; cai pro título normalizado só quando o pedido não tem
// SKU customizado. Usada tanto ao gravar em itens_demanda_ignorados
// quanto ao checar o item aqui dentro, então as duas pontas têm que
// usar exatamente essa mesma função.
export function chaveItemIgnorado(sku: string, titulo: string): string {
  return normalize(sku) || normalize(titulo);
}

export interface BaixaItem {
  placaId: number;
  pecas: number;
}

// Quantas peças de cada placa um pedido específico deve descontar do
// estoque físico assim que ele for marcado como enviado (ver
// pedidoFoiEnviado em lib/ml-orders.ts e app/api/estoque/sincronizar-vendas).
// Usa EXATAMENTE a mesma lógica de casamento de calcularDemandaSemanal
// (SKU exato via sku_placa, com o multiplicador pecas_por_unidade, senão
// fallback por texto contra sku_ou_kit/nome da placa) — assim o que "conta
// como vendido" pro cálculo de demanda é sempre o mesmo item que desconta
// do estoque real, sem os dois números poderem contradizer um ao outro.
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

    if (item.hasCustomSku) {
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
  const naoIdentificado: NaoIdentificado = {
    qtyPeriodo: 0,
    qtyFull: 0,
    amostras: [],
  };

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
      let casou = false;
      if (item.hasCustomSku) {
        const entradas = skuPlacaMap.get(normalize(item.sku));
        if (entradas && entradas.length > 0) {
          casou = true;
          for (const entrada of entradas) {
            somar(
              entrada.placaId,
              item.quantity * entrada.pecasPorUnidade,
              isFull
            );
          }
        }
      }

      // 2) Fallback por texto (título do anúncio / SKU vs. sku_ou_kit ou
      // nome comercial da placa), só usado quando não achou casamento
      // exato — placa ainda não cadastrada em sku_placa, ou pedido sem
      // SKU customizado na ML.
      if (!casou) {
        for (const placa of placas) {
          if (
            correspondeAoItem(placa, item.title) ||
            (item.hasCustomSku && correspondeAoItem(placa, item.sku))
          ) {
            casou = true;
            somar(placa.id, item.quantity, isFull);
          }
        }
      }

      // 3) Nada bateu — registra como não identificado em vez de
      // simplesmente sumir da conta, a menos que o Guilherme já tenha
      // marcado esse item pra ignorar (produto que não vende mais e
      // nunca vai ganhar uma placa no catálogo — ver
      // itens_demanda_ignorados / POST /api/producao/ignorar-item).
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
    // Meta = 1 semana no ritmo atual + 1 semana extra de reforço (2x).
    const recomendadoEstoque = Math.ceil(mediaSemanal * 2);
    const aProduzir = Math.max(0, recomendadoEstoque - placa.estoque);
    porPlaca.set(placa.id, {
      placaId: placa.id,
      qtyVendidaPeriodo,
      qtyVendidaFull,
      mediaSemanal,
      recomendadoEstoque,
      aProduzir,
    });
  }

  return { porPlaca, naoIdentificado };
}
