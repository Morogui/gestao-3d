import { NextRequest, NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { getOrdersRange } from "@/lib/ml-orders";
import { calcularDemandaSemanal, matchItemToPlacaIds, SkuPlacaMap } from "@/lib/demanda";
import { checkUserProductSeller, fetchFullStockForItems } from "@/lib/mercadolivre";
import { diasAtras, todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

// Coluna adicionada em 2026-08-07 — bug real reportado pelo Guilherme:
// "esse estoque do full tem que puxar certinho a quantidade que tem".
// Causa raiz: estoque_full_placas guardava o valor manual (fallback
// quando a API da ML não cobre) indexado só por placa_id — mas várias
// placas têm mais de um SKU/anúncio real vendido no Full (ex: Suporte
// Secador de Cabelo Preto "Com Parafuso" x "Sem Parafuso"), e cada
// variante precisa do PRÓPRIO número de estoque no Full, não um valor
// compartilhado entre elas. Agora a chave de verdade é "chave" (ver
// como é montada mais abaixo: só usa placa_id puro quando a placa tem
// no máximo 1 variante vendida na semana — preserva o valor já digitado
// nesses casos —, e usa placa_id+variante quando há mais de uma, pra
// separar de vez). Backfill: linhas antigas viram chave = placa_id
// (comportamento de sempre pra quem só winha 1 variante).
async function garantirColunaChave() {
  await sql`ALTER TABLE estoque_full_placas ADD COLUMN IF NOT EXISTS chave TEXT`;
  await sql`UPDATE estoque_full_placas SET chave = placa_id::text WHERE chave IS NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS estoque_full_placas_chave_idx ON estoque_full_placas (chave)`;
}

// Multiplicador de envio do Full — pedido do Guilherme em 2026-08-07:
// "o envio do full funciona todo produto vendido x 1.3 (esse valor
// temos que ter um campo para alterar)". Guarda um único valor global
// (edita pelo campo na aba Full — ver PATCH em /api/full/config),
// aplicado igual pra todos os produtos.
async function garantirConfigFull() {
  await sql`CREATE TABLE IF NOT EXISTS full_config (id SERIAL PRIMARY KEY, multiplicador NUMERIC NOT NULL DEFAULT 1.3)`;
  await sql`INSERT INTO full_config (multiplicador) SELECT 1.3 WHERE NOT EXISTS (SELECT 1 FROM full_config)`;
}

// Mesma normalização usada pra montar skuPlacaMap logo abaixo — extraída
// aqui também pra buscar o pecas_por_unidade de cada variante real
// vendida (necessário pra "Agendar Full" saber criar o envio certo pra
// SKUs de kit).
function normalizarChaveSku(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function pecasPorUnidadeParaPlaca(
  sku: string,
  placaId: number,
  skuPlacaMap: SkuPlacaMap
): number {
  if (!sku) return 1;
  const entradas = skuPlacaMap.get(normalizarChaveSku(sku));
  if (!entradas) return 1;
  const match = entradas.find((e) => e.placaId === placaId);
  return match ? match.pecasPorUnidade : 1;
}

// Aba Full: pra cada placa, mostra quanto vendeu no Full nos últimos 7
// dias (mesma fonte/lógica de lib/demanda.ts usada na aba Produção),
// quanto tem hoje de estoque NO Full e a recomendação de envio
// (reposição = o que vendeu no Full na semana × multiplicador — ver
// garantirConfigFull acima —, mesmo critério do "Lembrete Full" da aba
// Produção, agora ajustável).
//
// Estoque no Full: tentamos ler o valor REAL via API da ML (modelo User
// Products — GET /items/$ID -> user_product_id -> GET
// /user-products/$ID/stock, localização "meli_facility"). Isso só
// funciona pra placas que tiveram pelo menos 1 venda na janela de 7 dias
// (é dali que vem o item_id de cada placa) e só se a conta do vendedor
// já estiver no modelo User Products. Quando a API não devolve nada pra
// uma placa (sem venda recente, conta ainda no modelo antigo, etc.),
// caímos pro valor cadastrado manualmente em estoque_full_placas — agora
// separado por variante real quando há mais de uma (ver
// garantirColunaChave acima).
export async function GET() {
  await garantirColunaChave();
  await garantirConfigFull();

  const hoje = todaySP();
  const seteDiasAtras = diasAtras(hoje, 6);
  // Corrigido em 2026-08-08 — bug real reportado pelo Guilherme: "Suporte
  // secador com parafuso aparece na montagem e o sem parafuso não". Causa
  // raiz: variantesPorPlaca (mais abaixo) só descobria quais SKUs/anúncios
  // reais existem varrendo os pedidos da MESMA janela de 7 dias usada pra
  // calcular a recomendação de envio — então uma variante sem nenhuma
  // venda no Full nessa semana específica (ex: "Sem Parafuso Preto", que
  // vendeu 1x há 10 dias) simplesmente não gerava nenhuma linha, mesmo
  // sendo um anúncio real e ativo. Agora busca pedidos de uma janela bem
  // mais larga (30 dias) só pra DESCOBRIR quais variantes existem — a
  // conta de quanto vendeu/quanto recomendar mandar continua usando
  // exatamente os últimos 7 dias (ver "dentroDosUltimosSeteDias" mais
  // abaixo).
  const trintaDiasAtras = diasAtras(hoje, 29);

    const mlAuth = await getValidMLAccessToken();
      const accessToken = mlAuth?.accessToken;
      const userId = mlAuth?.userId;

  const configRows = (await sql`
    SELECT multiplicador FROM full_config ORDER BY id ASC LIMIT 1
  `) as { multiplicador: string }[];
  const multiplicador = Number(configRows[0]?.multiplicador ?? 1.3);

  // Diagnóstico: confirma se a conta já está no modelo "User Products"
  // da ML (tag user_product_seller) — sem essa tag, nenhum item vem com
  // user_product_id e a leitura automática do Full nunca vai funcionar,
  // não importa o que mais a gente tente. Expor isso na resposta evita
  // ficar adivinhando o motivo quando "apiDisponivel" vier false.
  const userProductStatus =
    accessToken && userId ? await checkUserProductSeller(userId, accessToken) : null;

  const result = await getOrdersRange(trintaDiasAtras, hoje);
  if (!result.connected) {
    return NextResponse.json({ connected: false });
  }
  if (result.error) {
    return NextResponse.json({ connected: true, error: true });
  }

  const placaRows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    WHERE p.descontinuada = false
    ORDER BY p.numero ASC
  `) as DbPlacaRow[];
  const placas = placaRows.map(toPlacaRow);

  const skuPlacaRows = (await sql`
    SELECT sku, placa_id, pecas_por_unidade FROM sku_placa
  `) as { sku: string; placa_id: number; pecas_por_unidade: string }[];
  const skuPlacaMap: SkuPlacaMap = new Map();
  for (const row of skuPlacaRows) {
    const chave = normalizarChaveSku(row.sku);
    const lista = skuPlacaMap.get(chave) ?? [];
    lista.push({
      placaId: row.placa_id,
      pecasPorUnidade: Number(row.pecas_por_unidade),
    });
    skuPlacaMap.set(chave, lista);
  }

  // Corte de verdade dos "últimos 7 dias" dentro dos pedidos de 30 dias
  // buscados acima (ver comentário em trintaDiasAtras) — usado tanto pra
  // manter a demanda semanal (Produção) igual a antes quanto pra decidir
  // quais pedidos contam em vendidoFull7d/recomendacaoEnvio mais abaixo.
  const cortesSeteDias = new Date(`${seteDiasAtras}T00:00:00-03:00`).getTime();
  function dentroDosUltimosSeteDias(dateCreated: string): boolean {
    return new Date(dateCreated).getTime() >= cortesSeteDias;
  }
  const ordersUltimos7Dias = result.orders.filter((o) => dentroDosUltimosSeteDias(o.dateCreated));

  const { porPlaca } = calcularDemandaSemanal(ordersUltimos7Dias, placas, skuPlacaMap, 7);

  const estoqueFullRows = (await sql`
    SELECT placa_id, chave, quantidade_pecas, atualizado_em FROM estoque_full_placas
  `) as { placa_id: number; chave: string; quantidade_pecas: number; atualizado_em: string }[];
  const estoqueFullPorChave = new Map(
    estoqueFullRows.map((r) => [r.chave, r])
  );

  // Descobre, a partir dos pedidos dos últimos 7 dias, quais item_id da
  // ML correspondem a cada placa (reaproveitando o mesmo casamento
  // SKU/texto usado no cálculo de demanda) — é esse item_id que dá
  // acesso ao user_product_id e, a partir dele, ao estoque real no Full.
  // Guarda também o título/SKU do anúncio de cada item_id, só pra
  // conseguir mostrar na tela QUAL anúncio da ML gerou aquele número —
  // sem isso fica impossível conferir o valor no painel da ML.
  const itemIdsPorPlaca = new Map<number, Set<string>>();
  const infoPorItemId = new Map<string, { titulo: string; sku: string }>();
  for (const order of result.orders) {
    for (const item of order.items) {
      if (!item.itemId || item.itemId === "—") continue;
      infoPorItemId.set(item.itemId, {
        titulo: item.title,
        sku: item.hasCustomSku ? item.sku : "",
      });
      const placaIds = matchItemToPlacaIds(item, placas, skuPlacaMap);
      for (const placaId of placaIds) {
        const set = itemIdsPorPlaca.get(placaId) ?? new Set<string>();
        set.add(item.itemId);
        itemIdsPorPlaca.set(placaId, set);
      }
    }
  }
  const todosItemIds = Array.from(
    new Set(Array.from(itemIdsPorPlaca.values()).flatMap((s) => Array.from(s)))
  );

  // Quebra por SKU/anúncio real da ML dentro de cada placa (ex: "Com
  // Parafuso" x "Sem Parafuso" da Cortina) — pedido pelo Guilherme porque
  // a produção/estoque local só precisa saber a cor (1 placa por cor),
  // mas na hora de mandar reposição pro Full e contar venda, cada SKU que
  // a própria ML traz precisa aparecer separado (o painel nativo da ML
  // também mostra estoque por anúncio, não somado). Chave = SKU
  // cadastrado no anúncio quando existe, senão o título do anúncio.
  interface VarianteAcumulada {
    label: string;
    sku: string;
    titulo: string;
    itemIds: Set<string>;
    vendidoFull7d: number;
  }
  const variantesPorPlaca = new Map<number, Map<string, VarianteAcumulada>>();
  for (const order of result.orders) {
    const isFull = order.shippingMode === "Full";
    const dentro7Dias = dentroDosUltimosSeteDias(order.dateCreated);
    for (const item of order.items) {
      if (!item.itemId || item.itemId === "—") continue;
      const placaIds = matchItemToPlacaIds(item, placas, skuPlacaMap);
      if (placaIds.length === 0) continue;
      const varianteKey = item.hasCustomSku
        ? `sku:${item.sku.toLowerCase()}`
        : `titulo:${item.title.toLowerCase()}`;
      const varianteLabel = item.hasCustomSku ? item.sku : item.title;
      for (const placaId of placaIds) {
        let variantes = variantesPorPlaca.get(placaId);
        if (!variantes) {
          variantes = new Map();
          variantesPorPlaca.set(placaId, variantes);
        }
        let acumulada = variantes.get(varianteKey);
        if (!acumulada) {
          acumulada = {
            label: varianteLabel,
            sku: item.hasCustomSku ? item.sku : "",
            titulo: item.title,
            itemIds: new Set(),
            vendidoFull7d: 0,
          };
          variantes.set(varianteKey, acumulada);
        }
        acumulada.itemIds.add(item.itemId);
        // Só conta como vendido na semana se o pedido realmente caiu nos
        // últimos 7 dias — a variante em si é descoberta numa janela mais
        // larga (30 dias, ver trintaDiasAtras acima), mas o número de
        // venda/recomendação de envio tem que continuar refletindo só a
        // semana, senão a recomendação ficaria inflada.
        if (isFull && dentro7Dias) acumulada.vendidoFull7d += item.quantity;
      }
    }
  }

  const fullStockLookup =
    accessToken && todosItemIds.length > 0
      ? await fetchFullStockForItems(todosItemIds, accessToken)
      : null;

  // Soma o estoque Full lido via API pra uma placa, deduplicando por
  // user_product_id (dois item_id diferentes podem apontar pro mesmo
  // produto físico/UP — sem isso contaríamos o mesmo estoque 2x).
  function estoqueFullViaApiParaItens(itemIds: Set<string> | undefined): number | null {
    if (!fullStockLookup || !itemIds) return null;
    const userProductIds = new Set<string>();
    for (const itemId of itemIds) {
      const info = fullStockLookup.perItem.get(itemId);
      if (info?.userProductId) userProductIds.add(info.userProductId);
    }
    if (userProductIds.size === 0) return null;
    let total = 0;
    let leuAlgo = false;
    for (const upId of userProductIds) {
      const qty = fullStockLookup.perUserProduct.get(upId);
      if (qty !== undefined) {
        total += qty;
        leuAlgo = true;
      }
    }
    return leuAlgo ? total : null;
  }

  // Pedido do Guilherme em 2026-07-25: "deve mostrar por SKU os produtos
  // que foram vendidos no full na semana... precisamos por sku
  // certinho". Cada linha da tela já É um SKU: uma placa com 2 SKUs
  // reais vendidos na semana (ex: Com/Sem Parafuso) vira 2 linhas (uma
  // por SKU), e uma placa sem venda no Full na semana continua
  // aparecendo com 1 linha só, usando o SKU cadastrado no catálogo.
  const linhas = placas.flatMap((placa) => {
    const variantesMap = variantesPorPlaca.get(placa.id);
    const numVariantes = variantesMap ? variantesMap.size : 0;

    if (variantesMap && numVariantes > 0) {
      return Array.from(variantesMap.entries()).map(([chaveVariante, v]) => {
        const apiFull = estoqueFullViaApiParaItens(v.itemIds);
        // Só separa a chave de estoque manual por variante quando a
        // placa realmente tem mais de 1 variante vendida na semana — se
        // tiver só 1, mantém a chave = placa_id (compatível com o valor
        // já digitado antes dessa correção, ver garantirColunaChave).
        const chave =
          numVariantes > 1 ? `${placa.id}:${chaveVariante}` : String(placa.id);
        const manual = estoqueFullPorChave.get(chave);
        const pecasPorUnidade = pecasPorUnidadeParaPlaca(v.sku, placa.id, skuPlacaMap);
        return {
          chave,
          placaId: placa.id,
          numero: placa.numero,
          nome: placa.nome,
          tier: placa.tier,
          sku: v.sku,
          titulo: v.titulo,
          estoqueLocal: placa.estoque,
          vendidoFull7d: v.vendidoFull7d,
          estoqueFullAtual: apiFull ?? manual?.quantidade_pecas ?? 0,
          fonteEstoqueFull: apiFull !== null ? "api" : "manual",
          atualizadoEm: manual?.atualizado_em ?? null,
          recomendacaoEnvio: Math.round(v.vendidoFull7d * multiplicador),
          pecasPorUnidade,
        };
      });
    }

    // Sem venda no Full na semana — 1 linha só, usando o SKU cadastrado
    // no catálogo (primeiro token antes do "|", mesmo padrão já usado em
    // outras telas). Chave sempre = placa_id (só existe 1 variante
    // possível aqui).
    const chave = String(placa.id);
    const manual = estoqueFullPorChave.get(chave);
    return [
      {
        chave,
        placaId: placa.id,
        numero: placa.numero,
        nome: placa.nome,
        tier: placa.tier,
        sku: placa.skuOuKit.split("|")[0].trim(),
        titulo: "",
        estoqueLocal: placa.estoque,
        vendidoFull7d: 0,
        estoqueFullAtual: manual?.quantidade_pecas ?? 0,
        fonteEstoqueFull: "manual" as const,
        atualizadoEm: manual?.atualizado_em ?? null,
        recomendacaoEnvio: 0,
        pecasPorUnidade: 1,
      },
    ];
  });

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio: seteDiasAtras, fim: hoje },
    apiDisponivel: linhas.some((l) => l.fonteEstoqueFull === "api"),
    userProductSeller: userProductStatus?.isUserProductSeller ?? null,
    multiplicador,
    linhas,
  });
}

// Ajuste manual do estoque atual no Full (soma/subtrai delta) — mesma
// mecânica de sempre, agora indexada por "chave" (placa_id sozinho
// quando a placa só tem 1 variante real vendida na semana, ou
// placa_id+variante quando tem mais de 1 — ver garantirColunaChave
// acima) em veh de só placa_id, pra não misturar o estoque de duas
// variantes diferentes da mesma placa (ex: Com Parafuso x Sem
// Parafuso).
export async function POST(req: NextRequest) {
  await garantirColunaChave();

  const body = await req.json();
  const chave = String(body.chave ?? "").trim();
  const placaId = Number(body.placaId);
  const delta = Number(body.delta);

  if (!chave || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json(
      { error: "Informe chave e um delta diferente de zero." },
      { status: 400 }
    );
  }

  const updated = (await sql`
    UPDATE estoque_full_placas
    SET quantidade_pecas = GREATEST(0, quantidade_pecas + ${delta}), atualizado_em = now()
    WHERE chave = ${chave}
    RETURNING placa_id, chave, quantidade_pecas, atualizado_em
  `) as { placa_id: number; chave: string; quantidade_pecas: number; atualizado_em: string }[];

  if (updated.length > 0) {
    return NextResponse.json(updated[0]);
  }

  if (!Number.isInteger(placaId) || placaId <= 0) {
    return NextResponse.json(
      { error: "placaId obrigatório pra cadastrar uma linha nova de estoque Full." },
      { status: 400 }
    );
  }

  const inserted = (await sql`
    INSERT INTO estoque_full_placas (placa_id, chave, quantidade_pecas, atualizado_em)
    VALUES (${placaId}, ${chave}, ${Math.max(0, delta)}, now())
    RETURNING placa_id, chave, quantidade_pecas, atualizado_em
  `) as { placa_id: number; chave: string; quantidade_pecas: number; atualizado_em: string }[];

  return NextResponse.json(inserted[0]);
}
