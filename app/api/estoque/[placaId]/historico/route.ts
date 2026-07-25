import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Histórico de movimentação de estoque de UMA placa — pedido do
// Guilherme em 2026-07-24 depois de perguntar "de onde tirou esses 37"
// sobre um número na aba Produção: antes disso o estoque só mostrava o
// total atual + "atualizado em", sem nenhuma forma de saber se aquele
// número veio de uma venda (baixa automática), de uma produção concluída
// ou de um ajuste manual. Junta as 3 fontes que mexem em
// estoque_placas.quantidade_pecas:
//
// 1) baixas_estoque_vendas — desconto automático quando um pedido conta
//    como vendido (ver /api/estoque/sincronizar-vendas). Tem
//    plataforma+pedido_id pra rastrear até o pedido de verdade.
// 2) producoes com status='concluida' — crédito quando uma impressão
//    termina (ver PATCH /api/producoes/[id]). Uma produção pode creditar
//    a PRÓPRIA placa e, se ela tiver "saída extra" (ex: uma placa mista
//    que também rende peça de outro papel do par), credita uma SEGUNDA
//    placa — por isso o UNION busca dos dois lados (placa_id direto e
//    saida_extra_placa_id apontando pra cá).
// 3) ajustes_manuais_estoque — ajuste manual feito na aba Estoque (ver
//    POST /api/estoque). Não existia log nenhum disso até este pedido;
//    a tabela foi criada só agora (2026-07-24).
// 4) baixas_estoque_full_envios — baixa automática quando um envio
//    planejado do Full é CONFIRMADO na aba Full (ver PATCH
//    /api/full/envios/[id]). Criada em 2026-07-26, mesmo padrão da
//    baixa de vendas, mas disparada pela confirmação do envio, não por
//    um pedido.
export async function GET(
  req: NextRequest,
  { params }: { params: { placaId: string } }
) {
  const placaId = Number(params.placaId);
  if (!Number.isInteger(placaId)) {
    return NextResponse.json({ error: "placaId inválido" }, { status: 400 });
  }

  // Awaits sequenciais (em vez de Promise.all com cast do tipo da
  // promise) — o driver do Neon devolve um "NeonQueryPromise" que não
  // converte direto pra Promise<T[]> via "as" (dava erro de build:
  // "Types of property 'then' are incompatible"). O padrão já usado no
  // resto do código é sempre `(await sql\`...\`) as T[]`, depois do
  // await — mantém a mesma convenção aqui.
  const vendas = (await sql`
    SELECT criado_em AS data, plataforma, pedido_id, pecas
    FROM baixas_estoque_vendas
    WHERE placa_id = ${placaId}
    ORDER BY criado_em DESC
    LIMIT 100
  `) as { data: string; plataforma: string; pedido_id: string; pecas: number }[];

  const manuais = (await sql`
    SELECT criado_em AS data, delta, resultante
    FROM ajustes_manuais_estoque
    WHERE placa_id = ${placaId}
    ORDER BY criado_em DESC
    LIMIT 100
  `) as { data: string; delta: number; resultante: number }[];

  const producoesProprio = (await sql`
    SELECT
      p.id, p.concluido_em AS data, p.quantidade_placas,
      pl.pecas_por_placa,
      COALESCE((SELECT count(*)::int FROM falhas_peca f WHERE f.producao_id = p.id), 0) AS pecas_com_falha
    FROM producoes p
    JOIN placas pl ON pl.id = p.placa_id
    WHERE p.placa_id = ${placaId} AND p.status = 'concluida'
    ORDER BY p.concluido_em DESC
    LIMIT 100
  `) as {
    id: number;
    data: string;
    quantidade_placas: string;
    pecas_por_placa: string;
    pecas_com_falha: number;
  }[];

  const producoesExtra = (await sql`
    SELECT p.id, p.concluido_em AS data, p.quantidade_placas, pl.saida_extra_pecas
    FROM producoes p
    JOIN placas pl ON pl.id = p.placa_id
    WHERE pl.saida_extra_placa_id = ${placaId} AND p.status = 'concluida'
    ORDER BY p.concluido_em DESC
    LIMIT 100
  `) as { id: number; data: string; quantidade_placas: string; saida_extra_pecas: string }[];

  const baixasFull = (await sql`
    SELECT criado_em AS data, envio_id, pecas
    FROM baixas_estoque_full_envios
    WHERE placa_id = ${placaId}
    ORDER BY criado_em DESC
    LIMIT 100
  `) as { data: string; envio_id: number; pecas: number }[];

  type Movimento = {
    data: string;
    tipo: "venda" | "producao" | "manual" | "full";
    quantidade: number;
    detalhe: string;
  };

  const movimentos: Movimento[] = [];

  for (const v of vendas) {
    movimentos.push({
      data: v.data,
      tipo: "venda",
      quantidade: -v.pecas,
      detalhe: `${v.plataforma === "shopee" ? "Shopee" : "Mercado Livre"} · pedido ${v.pedido_id}`,
    });
  }

  for (const m of manuais) {
    movimentos.push({
      data: m.data,
      tipo: "manual",
      quantidade: m.delta,
      detalhe: `Ajuste manual (ficou em ${m.resultante})`,
    });
  }

  for (const p of producoesProprio) {
    const pecas =
      Number(p.quantidade_placas) * Number(p.pecas_por_placa) - p.pecas_com_falha;
    if (pecas === 0) continue;
    movimentos.push({
      data: p.data,
      tipo: "producao",
      quantidade: pecas,
      detalhe: `Produção #${p.id} concluída (${p.quantidade_placas} placa(s))`,
    });
  }

  for (const p of producoesExtra) {
    const pecas = Number(p.quantidade_placas) * Number(p.saida_extra_pecas);
    if (pecas === 0) continue;
    movimentos.push({
      data: p.data,
      tipo: "producao",
      quantidade: pecas,
      detalhe: `Produção #${p.id} concluída (saída extra)`,
    });
  }

  for (const b of baixasFull) {
    movimentos.push({
      data: b.data,
      tipo: "full",
      quantidade: -b.pecas,
      detalhe: `Envio Full confirmado #${b.envio_id}`,
    });
  }

  movimentos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return NextResponse.json({ movimentos: movimentos.slice(0, 50) });
}
