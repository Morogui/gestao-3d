import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { getOrdersRange } from "@/lib/ml-orders";
import { calcularDemandaSemanal, matchItemToPlacaIds, SkuPlacaMap } from "@/lib/demanda";
import { checkUserProductSeller, fetchFullStockForItems } from "@/lib/mercadolivre";
import { diasAtras, todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

// Aba Full: pra cada placa, mostra quanto vendeu no Full nos últimos 7
// dias (mesma fonte/lógica de lib/demanda.ts usada na aba Produção),
// quanto tem hoje de estoque NO Full e a recomendação de envio
// (reposição = o que vendeu no Full na semana, mesmo critério já usado
// no "Lembrete Full" da aba Produção).
//
// Estoque no Full: tentamos ler o valor REAL via API da ML (modelo User
// Products — GET /items/$ID -> user_product_id -> GET
// /user-products/$ID/stock, localização "meli_facility"). Isso só
// funciona pra placas que tiveram pelo menos 1 venda na janela de 7 dias
// (é dali que vem o item_id de cada placa) e só se a conta do vendedor
// já estiver no modelo User Products. Quando a API não devolve nada pra
// uma placa (sem venda recente, conta ainda no modelo antigo, etc.),
// caímos pro valor cadastrado manualmente em estoque_full_placas.
export async function GET() {
  const hoje = todaySP();
  const seteDiasAtras = diasAtras(hoje, 6);

  const cookieStore = cookies();
  const accessToken = cookieStore.get("ml_access_token")?.value;
  const userId = cookieStore.get("ml_user_id")?.value;

  // Diagnóstico: confirma se a conta já está no modelo "User Products"
  // da ML (tag user_product_seller) — sem essa tag, nenhum item vem com
  // user_product_id e a leitura automática do Full nunca vai funcionar,
  // não importa o que mais a gente tente. Expor isso na resposta evita
  // ficar adivinhando o motivo quando "apiDisponivel" vier false.
  const userProductStatus =
    accessToken && userId ? await checkUserProductSeller(userId, accessToken) : null;

  const result = await getOrdersRange(seteDiasAtras, hoje);
  if (!result.connected) {
    return NextResponse.json({ connected: false });
  }
  if (result.error) {
    return NextResponse.json({ connected: true, error: true });
  }

  const placaRows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
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
    const chave = row.sku
      .toLowerCase()
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    const lista = skuPlacaMap.get(chave) ?? [];
    lista.push({
      placaId: row.placa_id,
      pecasPorUnidade: Number(row.pecas_por_unidade),
    });
    skuPlacaMap.set(chave, lista);
  }

  const { porPlaca } = calcularDemandaSemanal(result.orders, placas, skuPlacaMap, 7);

  const estoqueFullRows = (await sql`
    SELECT placa_id, quantidade_pecas, atualizado_em FROM estoque_full_placas
  `) as { placa_id: number; quantidade_pecas: number; atualizado_em: string }[];
  const estoqueFullPorPlaca = new Map(
    estoqueFullRows.map((r) => [r.placa_id, r])
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
    itemIds: Set<string>;
    vendidoFull7d: number;
  }
  const variantesPorPlaca = new Map<number, Map<string, VarianteAcumulada>>();
  for (const order of result.orders) {
    const isFull = order.shippingMode === "Full";
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
          acumulada = { label: varianteLabel, itemIds: new Set(), vendidoFull7d: 0 };
          variantes.set(varianteKey, acumulada);
        }
        acumulada.itemIds.add(item.itemId);
        if (isFull) acumulada.vendidoFull7d += item.quantity;
      }
    }
  }

  // Lista (deduplicada por título) dos anúncios da ML que casaram com
  // uma placa — exibida na tela pra dar rastreabilidade do número.
  function anunciosDaPlaca(placaId: number): { titulo: string; sku: string }[] {
    const itemIds = itemIdsPorPlaca.get(placaId);
    if (!itemIds) return [];
    const vistos = new Set<string>();
    const anuncios: { titulo: string; sku: string }[] = [];
    for (const itemId of itemIds) {
      const info = infoPorItemId.get(itemId);
      if (!info) continue;
      const chave = info.titulo + "|" + info.sku;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      anuncios.push(info);
    }
    return anuncios;
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

  function estoqueFullViaApi(placaId: number): number | null {
    return estoqueFullViaApiParaItens(itemIdsPorPlaca.get(placaId));
  }

  const linhas = placas.map((placa) => {
    const demanda = porPlaca.get(placa.id);
    const vendidoFull7d = demanda?.qtyVendidaFull ?? 0;
    const full = estoqueFullPorPlaca.get(placa.id);
    const apiFull = estoqueFullViaApi(placa.id);
    const estoqueFullAtual = apiFull ?? full?.quantidade_pecas ?? 0;

    // Só mostra quebra por variante quando há mais de 1 SKU/anúncio real
    // distinto vendido nessa placa na semana — placas com 1 SKU só (a
    // maioria do catálogo) continuam exatamente como antes.
    const variantesMap = variantesPorPlaca.get(placa.id);
    const variantes =
      variantesMap && variantesMap.size > 1
        ? Array.from(variantesMap.values()).map((v) => ({
            label: v.label,
            vendidoFull7d: v.vendidoFull7d,
            estoqueFullAtual: estoqueFullViaApiParaItens(v.itemIds),
          }))
        : [];

    return {
      placaId: placa.id,
      numero: placa.numero,
      nome: placa.nome,
      tier: placa.tier,
      skuOuKit: placa.skuOuKit,
      estoqueLocal: placa.estoque,
      vendidoFull7d,
      estoqueFullAtual,
      // Anúncio(s) da ML que geraram esse número — pra conferir no
      // painel da ML que é o produto certo.
      anuncios: anunciosDaPlaca(placa.id),
      // "api" = lido agora mesmo da ML (mais confiável); "manual" = caiu
      // pro valor que você digitou aqui (sem venda recente pra achar o
      // item, ou conta ainda fora do modelo User Products).
      fonteEstoqueFull: apiFull !== null ? "api" : "manual",
      atualizadoEm: full?.atualizado_em ?? null,
      // Recomendação simples: reponha o que vendeu no Full na semana —
      // mesmo critério já usado no "Lembrete Full" da aba Produção.
      recomendacaoEnvio: vendidoFull7d,
      variantes,
    };
  });

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio: seteDiasAtras, fim: hoje },
    apiDisponivel: linhas.some((l) => l.fonteEstoqueFull === "api"),
    userProductSeller: userProductStatus?.isUserProductSeller ?? null,
    linhas,
  });
}

// Ajuste manual do estoque atual no Full (soma/subtrai delta) — mesma
// mecânica do /api/estoque, só que na tabela estoque_full_placas.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const placaId = Number(body.placaId);
  const delta = Number(body.delta);

  if (!placaId || !Number.isFinite(delta) || delta === 0) {
    return NextResponse.json(
      { error: "Informe placaId e um delta diferente de zero." },
      { status: 400 }
    );
  }

  const rows = (await sql`
    UPDATE estoque_full_placas
    SET quantidade_pecas = GREATEST(0, quantidade_pecas + ${delta}), atualizado_em = now()
    WHERE placa_id = ${placaId}
    RETURNING placa_id, quantidade_pecas, atualizado_em
  `) as { placa_id: number; quantidade_pecas: number; atualizado_em: string }[];

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Placa sem linha de estoque Full cadastrada — avise o suporte." },
      { status: 404 }
    );
  }

  return NextResponse.json(rows[0]);
}
