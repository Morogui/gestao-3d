import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Historico de movimentacao de estoque de UMA placa - pedido do
// Guilherme em 2026-07-24 depois de perguntar "de onde tirou esses 37"
// sobre um numero na aba Producao: antes disso o estoque so mostrava o
// total atual + "atualizado em", sem nenhuma forma de saber se aquele
// numero veio de uma venda (baixa automatica), de uma producao concluida
// ou de um ajuste manual. Junta as 3 fontes que mexem em
// estoque_placas.quantidade_pecas:
//
// 1) baixas_estoque_vendas - desconto automatico quando um pedido conta
//    como vendido (ver /api/estoque/sincronizar-vendas). Tem
//    plataforma+pedido_id pra rastrear ate o pedido de verdade.
// 2) producoes com status='concluida' - credito quando uma impressao
//    termina (ver PATCH /api/producoes/[id]). Uma producao pode creditar
//    a PROPRIA placa e, se ela tiver "saida extra" (ex: uma placa mista
//    que tambem rende peca de outro papel do par), credita uma SEGUNDA
//    placa - por isso busca dos dois lados (placa_id direto e
//    saida_extra_placa_id apontando pra ca).
// 3) ajustes_manuais_estoque - ajuste manual feito na aba Estoque (ver
//    POST /api/estoque). Nao existia log nenhum disso ate este pedido;
//    a tabela foi criada so agora (2026-07-24).
export async function GET(
    req: NextRequest,
  { params }: { params: { placaId: string } }
  ) {
    const placaId = Number(params.placaId);
    if (!Number.isInteger(placaId)) {
          return NextResponse.json({ error: "placaId invalido" }, { status: 400 });
    }

  // Awaits sequenciais (em vez de Promise.all com cast do tipo da
  // promise) - o driver do Neon devolve um "NeonQueryPromise" que nao
  // converte direto pra Promise<T[]> via "as" (dava erro de build:
  // "Types of property 'then' are incompatible"). O padrao ja usado no
  // resto do codigo e sempre `(await sql...) as T[]`, depois do
  // await - mantem a mesma convencao aqui.
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

  type Movimento = {
        data: string;
        tipo: "venda" | "producao" | "manual";
        quantidade: number;
        detalhe: string;
  };

  const movimentos: Movimento[] = [];

  for (const v of vendas) {
        movimentos.push({
                data: v.data,
                tipo: "venda",
                quantidade: -v.pecas,
                detalhe: `${v.plataforma === "shopee" ? "Shopee" : "Mercado Livre"} - pedido ${v.pedido_id}`,
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
                detalhe: `Producao #${p.id} concluida (${p.quantidade_placas} placa(s))`,
        });
  }

  for (const p of producoesExtra) {
        const pecas = Number(p.quantidade_placas) * Number(p.saida_extra_pecas);
        if (pecas === 0) continue;
        movimentos.push({
                data: p.data,
                tipo: "producao",
                quantidade: pecas,
                detalhe: `Producao #${p.id} concluida (saida extra)`,
        });
  }

  movimentos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return NextResponse.json({ movimentos: movimentos.slice(0, 50) });
}
