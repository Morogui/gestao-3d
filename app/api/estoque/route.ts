import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { statusIndicaDespachado } from "@/lib/demanda";
import { todaySP } from "@/lib/date";

export const dynamic = "force-dynamic";

// Quanto já foi descontado do estoque HOJE por vendas que ainda não
// despacharam de verdade na plataforma — pedido do Guilherme em
// 2026-07-29: "mostrar em cor mais fraca a quantidade que já foi
// descontado do meu estoque no dia atual pelas vendas e deve sair da
// contagem assim que o pedido der saída". A baixa em si já acontece no
// PAGAMENTO (ver /api/estoque/sincronizar-vendas, 2026-07-24) — isso aqui
// é só um recorte informativo por cima do mesmo dado: das baixas de HOJE
// (baixas_estoque_vendas.criado_em, fuso São Paulo), quais ainda não têm
// o pedido despachado (shipping_status em pedidos_cache). Assim que o
// pedido despacha, some do badge sozinho na próxima leitura — sem mexer
// no estoque_placas, que já está correto desde o pagamento.
async function buscarPendenteHojePorPlaca(): Promise<Map<number, number>> {
  const hoje = todaySP();
  const rows = (await sql`
    SELECT b.placa_id, b.pecas, pc.shipping_status
    FROM baixas_estoque_vendas b
    LEFT JOIN pedidos_cache pc
      ON pc.plataforma = b.plataforma AND pc.pedido_id = b.pedido_id
    WHERE (b.criado_em AT TIME ZONE 'America/Sao_Paulo')::date = (${hoje}::date)
  `) as { placa_id: number; pecas: number; shipping_status: string | null }[];

  const mapa = new Map<number, number>();
  for (const r of rows) {
    if (statusIndicaDespachado(r.shipping_status)) continue;
    mapa.set(r.placa_id, (mapa.get(r.placa_id) ?? 0) + Number(r.pecas));
  }
  return mapa;
}

// Igual à /api/placas, mas SEM o filtro "descontinuada = false" — a aba
// Estoque precisa mostrar e permitir ajustar manualmente até placas
// descontinuadas (ex: Taça Copa do Mundo, que não produzimos mais mas
// ainda vende o que sobrou em estoque).
export async function GET() {
  const rows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque,
      e.atualizado_em
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    ORDER BY p.numero ASC
  `) as (DbPlacaRow & { atualizado_em: string | null })[];

  const pendentePorPlaca = await buscarPendenteHojePorPlaca();

  return NextResponse.json(
    rows.map((row) => ({
      ...toPlacaRow(row),
      atualizadoEm: row.atualizado_em,
      pendenteEnvioHoje: pendentePorPlaca.get(row.id) ?? 0,
    }))
  );
}

// Ajuste manual de estoque — soma (ou subtrai, se negativo) "delta" ao
// quantidade_pecas atual da placa. Escreve direto na mesma tabela
// estoque_placas que a aba Produção lê/credita ao concluir uma
// impressão, então as duas telas ficam sempre em sincronia.
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

  // Nem toda placa necessariamente já tem uma linha em estoque_placas
  // (placas novas cadastradas depois podem ficar sem — foi o caso do
  // Suporte Secador de Cabelo Preto, cujo ajuste manual não gravava nada
  // e falhava em silêncio porque o UPDATE não achava linha nenhuma pra
  // atualizar). Por isso usamos INSERT ... ON CONFLICT (upsert): cria a
  // linha na hora se não existir, ou soma no delta se já existir —
  // funciona nos dois casos sem precisar de uma migração de backfill.
  const rows = (await sql`
    INSERT INTO estoque_placas (placa_id, quantidade_pecas, atualizado_em)
    VALUES (${placaId}, GREATEST(0, ${delta}), now())
    ON CONFLICT (placa_id) DO UPDATE
    SET quantidade_pecas = GREATEST(0, estoque_placas.quantidade_pecas + ${delta}), atualizado_em = now()
    RETURNING placa_id, quantidade_pecas, atualizado_em
  `) as { placa_id: number; quantidade_pecas: number; atualizado_em: string }[];

  // Registra o ajuste em ajustes_manuais_estoque — pedido do Guilherme em
  // 2026-07-24 depois de perguntar "de onde tirou esses 37" sobre um
  // número de estoque: antes disso não existia NENHUM histórico de ajuste
  // manual (só o valor atual + "atualizado em"), então não dava pra saber
  // se um número veio de venda, produção ou de um ajuste manual, nem
  // quando. Guarda o delta aplicado e o total resultante, pra aparecer
  // junto com vendas (baixas_estoque_vendas) e produção (producoes) na
  // aba "Ver histórico" de cada placa.
  await sql`
    INSERT INTO ajustes_manuais_estoque (placa_id, delta, resultante)
    VALUES (${placaId}, ${delta}, ${rows[0].quantidade_pecas})
  `;

  return NextResponse.json(rows[0]);
}
