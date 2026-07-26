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

// "Despachado" = já saiu de fato (rastreio gerado/coletado) ou já
// confirmado entregue. Cobre tanto o shippingStatus bruto da ML quanto o
// da Shopee (que reaproveita o order_status — ver comentário em
// OrderSummary). Qualquer outro valor (pending, handling, ready_to_ship,
// to_ship, vazio etc.) conta como AINDA NÃO despachado — backlog real de
// despacho. Pedido do Guilherme em 2026-07-25, depois de ver "Suporte
// Mangueira (Prata)" com 10 pedidos pagos e só 6 já despachados
// (ready_to_ship/pending), enquanto o estoque físico só tinha 1 peça:
// isso é MUITO mais urgente que a meta média de "dias de estoque",
// porque é um pedido concreto esperando, não uma projeção.
const DESPACHADO = new Set([
  "shipped",
  "delivered",
  "completed",
  "to_confirm_receive",
]);
function pedidoAindaNaoDespachado(order: OrderSummary): boolean {
  return !DESPACHADO.has((order.shippingStatus || "").toLowerCase());
}

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
    const tokensAlvoArr = alvo.split(" ");
    const tokensAlvo = new Set(tokensAlvoArr);
    if (!palavrasRef.every((p) => tokensAlvo.has(p))) return false;

    // Guarda de especificidade — bug real 2026-07-24: "Suporte Universal
    // Branco" (skuOuKit com só 3 palavras significativas: suporte,
    // universal, branco) estava casando com o pedido "Suporte Organizador
    // Universal Parede Para Secador De Cabelo Branco Sem Parafuso" — um
    // produto completamente diferente (suporte de secador de cabelo, não
    // cadastrado no catálogo) que só por coincidência contém essas mesmas
    // 3 palavras genéricas dentro de um título bem mais longo. Quando a
    // referência é curta e o alvo é bem mais genérico/longo, "todas as
    // palavras da referência presentes" deixa de ser um sinal confiável.
    // Exige que a referência represente pelo menos 40% das palavras
    // significativas do alvo — suficiente pra continuar tolerando
    // reordenação/marketing (ex: "Suporte Universal" batendo em anúncios
    // com só mais 1-2 palavras extras), mas rejeita casos onde a
    // referência é só uma pequena fração perdida dentro de um título de
    // um produto não relacionado.
    const palavrasAlvoSignificativas = new Set(
      tokensAlvoArr.filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    );
    if (palavrasRef.length / palavrasAlvoSignificativas.size < 0.4) {
      return false;
    }

    return true;
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
// Bug real 2026-07-26: título "Suporte Porta Escova Para Parede Cabelo
// Organizador Gillete Branco Suporte Preto" tem DUAS cores no texto
// ("branco" de um trecho de marketing tipo marca/compatibilidade,
// "preto" no final indicando a cor real do produto) — a versão antiga
// desta função retornava sempre a primeira cor da lista
// CORES_CONHECIDAS que aparecesse no texto (prioridade fixa, não a
// ordem real das palavras), então sempre pegava "branco" e travava no
// guard de cor mesmo pro anúncio certo. Convenção observada nos títulos
// da ML: a cor real do produto normalmente vem por último (o resto
// antes costuma ser nome comercial/compatibilidade). Por isso agora
// pega a ÚLTIMA cor conhecida que aparece na ordem do texto, não a
// primeira da lista de prioridade.
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

function correspondeAoItem(placa: PlacaRow, tituloOuSku: string): boolean {
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
  // Data (ISO) do pedido mais recente que bateu com essa placa dentro do
  // período usado nessa chamada — null se não vendeu nada no período.
  // Adicionado em 2026-07-24 a pedido do Guilherme: produto sem venda
  // recente (últimos 14 dias) não deve competir por prioridade máxima só
  // por estar com estoque zerado — vira última prioridade até vender de
  // novo. Ver critério nº0 da fila de prioridade em app/producao/page.tsx.
  ultimaVendaEm: string | null;
  // Peças de pedidos já VENDIDOS (pagos) mas ainda NÃO despachados dentro
  // do período — backlog real de despacho, não projeção. Pedido do
  // Guilherme em 2026-07-25: isso é mais urgente que a meta de "dias de
  // estoque" — um pedido concreto esperando pra sair vale mais que a
  // média histórica. Ver critério nº-1 da fila de prioridade em
  // app/producao/page.tsx.
  pecasPendentesDespacho: number;
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
// estoque físico assim que ele contar como vendido/pago (ver
// pedidoFoiVendido em lib/ml-orders.ts e app/api/estoque/sincronizar-vendas).
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
  // Data do pedido mais recente que bateu com cada placa — usado só pra
  // decidir "vendeu nas últimas 2 semanas?" na fila de prioridade, não
  // afeta qtyVendidaPeriodo/mediaSemanal/aProduzir.
  const ultimaVendaPorPlaca = new Map<number, string>();
  // Peças de pedidos pagos e ainda não despachados — backlog real (ver
  // pedidoAindaNaoDespachado acima). Acumulado por pedido (não por item),
  // já que "despachado?" é uma propriedade do pedido inteiro, não do item.
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
    // Calculado 1x por pedido (não por item) — "vendido e ainda não
    // despachado" é uma propriedade do pedido inteiro.
    const pendenteDespacho =
      pedidoFoiVendido(order) && pedidoAindaNaoDespachado(order);
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
              isFull,
              order.dateCreated,
              pendenteDespacho
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
    // Meta mudou em 2026-07-24 (pedido do Guilherme): antes era 2 semanas
    // (1 semana no ritmo atual + 1 de reforço). Agora é 1 MÊS de venda ×
    // 1.3 — "sempre use como base a quantidade vendida do produto no mês
    // anterior x1.3". Escala mediaSemanal pra uma estimativa mensal (em
    // vez de usar qtyVendidaPeriodo direto) pra continuar correto mesmo
    // quando essa função é chamada com um período diferente de 30 dias
    // (ex: a versão de 7 dias usada só pro card do Full).
    const mediaMensal = (qtyVendidaPeriodo / diasNoPeriodo) * 30;
    const recomendadoEstoque = Math.ceil(mediaMensal * 1.3);
    // Placa descontinuada NUNCA entra na recomendação de produção, mesmo
    // que o casamento de texto ainda detecte alguma venda residual dentro
    // do período (ex: pedido antigo de antes de parar de vender, ou um
    // falso-positivo do casamento por palavras). Pedido do Guilherme em
    // 2026-07-24, depois de ver "Porta Copo Taça do Mundo" e "Troféu Copa
    // do Mundo" (produtos que não vende mais) no topo da fila de
    // prioridade: "só desconsidera as vendas dele pra linha de produção".
    // qtyVendidaPeriodo/mediaSemanal continuam calculados normalmente (são
    // informativos), só aProduzir é zerado.
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
