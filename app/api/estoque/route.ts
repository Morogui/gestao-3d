import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DbPlacaRow, toPlacaRow } from "@/lib/placas";
import { statusIndicaDespachado } from "@/lib/demanda";
import { todaySP } from "@/lib/date";
import { ajustarEstoque } from "@/lib/estoque-ajuste";

export const dynamic = "force-dynamic";

// Ajusta (soma ou subtrai) gramas no estoque de filamento por cor e o
// upsert em estoque_placas + histórico em ajustes_manuais_estoque —
// lógica movida pra lib/estoque-ajuste.ts em 2026-08-17 pra poder ser
// reaproveitada também pelo lançamento de estoque via Telegram (ver
// app/api/telegram/webhook/route.ts). Ver lib/estoque-ajuste.ts pro
// histórico completo da regra (pedido original do Guilherme em
// 2026-07-29).

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
//
// Exceção — QUALQUER placa descontinuada com estoque zerado (local E
// Full): pedido original do Guilherme em 2026-07-31, olhando o BMW
// (ganchos avulsos aposentados na consolidação do Gancho Compartilhado —
// ver /api/admin/consolidar-gancho-compartilhado e
// /api/admin/finalizar-consolidacao-gancho): "Esse antigo tem que tirar
// do sistema. Para não confundir na hora da produção e na hora de lançar
// estoque". Generalizado no mesmo dia depois de descontinuar também
// "Suporte BMW - Corpos (Branco/Preto)" (ver
// /api/admin/corrigir-bmw-so-mista — não existe placa física só de corpo
// pro BMW, só a Mista) e o Guilherme pedir de novo "Tirar o
// descontinuado" olhando essas linhas na aba Estoque. Regra única agora
// (não mais restrita ao prefixo "GANCHO ANTIGO "): qualquer placa
// descontinuada + zerada nos dois estoques some da lista — o histórico de
// movimentação continua acessível via link direto de "Ver histórico" se
// precisar. NÃO esconde placas descontinuadas com saldo real pra vender
// (ex: Taça Copa do Mundo) nem nenhuma delas antes de zerar de vez.
export async function GET() {
  const rows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto,
      p.sku_ou_kit, p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada,
      COALESCE(e.quantidade_pecas, 0) AS estoque,
      e.atualizado_em,
      COALESCE(ef.quantidade_pecas, 0) AS estoque_full
    FROM placas p
    LEFT JOIN estoque_placas e ON e.placa_id = p.id
    LEFT JOIN estoque_full_placas ef ON ef.placa_id = p.id
    WHERE NOT (
      p.descontinuada = true
      AND COALESCE(e.quantidade_pecas, 0) = 0
      AND COALESCE(ef.quantidade_pecas, 0) = 0
    )
    ORDER BY p.numero ASC
  `) as (DbPlacaRow & { atualizado_em: string | null; estoque_full: number })[];

  const pendentePorPlaca = await buscarPendenteHojePorPlaca();

  return NextResponse.json(
    rows.map((row) => ({
      ...toPlacaRow(row),
      atualizadoEm: row.atualizado_em,
      pendenteEnvioHoje: pendentePorPlaca.get(row.id) ?? 0,
      // Estoque separado, guardado à parte do local — pedido do
      // Guilherme em 2026-07-29: "os estoques são diferentes". Mesma
      // tabela (estoque_full_placas) já usada/ajustável na aba Full;
      // aqui é só leitura, pra dar visão dos dois estoques lado a lado
      // sem duplicar a edição em duas telas.
      estoqueFull: Number(row.estoque_full ?? 0),
    }))
  );
}

// Ajuste manual de estoque — soma (ou subtrai, se negativo) "delta" ao
// quantidade_pecas atual da placa. Escreve direto na mesma tabela
// estoque_placas que a aba Produção lê/credita ao concluir uma
// impressão, então as duas telas ficam sempre em sincronia. Desde
// 2026-08-17 a lógica de fato vive em lib/estoque-ajuste.ts (ver
// ajustarEstoque), reaproveitada também pelo lançamento via Telegram.
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

  const resultado = await ajustarEstoque(placaId, delta);

  return NextResponse.json({
    placa_id: resultado.placaId,
    quantidade_pecas: resultado.quantidadePecas,
    atualizado_em: resultado.atualizadoEm,
  });
}
