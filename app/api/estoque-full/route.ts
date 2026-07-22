import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { getOrdersRange } from "@/lib/ml-orders";
import { calcularDemandaSemanal, SkuPlacaMap } from "@/lib/demanda";
import { diasAtras, todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

// Aba Full: pra cada placa, mostra quanto vendeu no Full nos últimos 7
// dias (mesma fonte/lógica de lib/demanda.ts usada na aba Produção),
// quanto tem hoje de estoque NO Full — controlado manualmente aqui,
// numa tabela própria (estoque_full_placas), já que a API da ML não
// expõe isso hoje sem um escopo/integração de Fulfillment separada — e a
// recomendação de envio (reposição = o que vendeu no Full na semana,
// mesmo critério já usado no "Lembrete Full" da aba Produção).
export async function GET() {
  const hoje = todaySP();
  const seteDiasAtras = diasAtras(hoje, 6);

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

  const linhas = placas.map((placa) => {
    const demanda = porPlaca.get(placa.id);
    const vendidoFull7d = demanda?.qtyVendidaFull ?? 0;
    const full = estoqueFullPorPlaca.get(placa.id);
    const estoqueFullAtual = full?.quantidade_pecas ?? 0;
    return {
      placaId: placa.id,
      numero: placa.numero,
      nome: placa.nome,
      tier: placa.tier,
      skuOuKit: placa.skuOuKit,
      estoqueLocal: placa.estoque,
      vendidoFull7d,
      estoqueFullAtual,
      atualizadoEm: full?.atualizado_em ?? null,
      // Recomendação simples: reponha o que vendeu no Full na semana —
      // mesmo critério já usado no "Lembrete Full" da aba Produção.
      recomendacaoEnvio: vendidoFull7d,
    };
  });

  return NextResponse.json({
    connected: true,
    error: false,
    periodo: { inicio: seteDiasAtras, fim: hoje },
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
