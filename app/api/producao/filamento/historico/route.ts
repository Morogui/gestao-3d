import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { corFilamentoDaPlaca } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Histórico de movimentação de estoque de FILAMENTO (por cor) — pedido
// do Guilherme em 2026-07-28: "tenho que ter uma abinha para ver a
// movimentacao que esta rolando no meu estoque, qual foi a producao e
// o que foi consumido", perguntado logo depois de olhar o card
// "Estoque de filamento por cor" na aba Produção. Mesmo padrão já usado
// em /api/estoque/[placaId]/historico (une, ao vivo, as tabelas que
// mexem no saldo, em vez de manter um ledger dedicado) — aqui unindo as
// 4 fontes que mexem em estoque_filamento:
//
// 1) producoes com status='concluida' — consumo automático quando uma
//    impressão termina (ver descontarFilamento em
//    /api/producoes/[id]/route.ts): quantidade_placas × peso_placa_gramas
//    da placa, atribuído à cor via corFilamentoDaPlaca(placa.nome).
// 2) producoes com status='falha_placa' — consumo/perda quando a placa
//    inteira falha: usa gramas_desperdicadas (o que o operador informou
//    ter sido gasto até a falha), não o peso cheio da placa.
// 3) perdas_filamento_manual — perda avulsa registrada manualmente (ver
//    /api/producao/perda-filamento), já tem cor+gramas+motivo+data.
// 4) ajustes_manuais_filamento — toda vez que o campo "Estoque de
//    filamento por cor" é salvo com um valor diferente do atual (ver PUT
//    /api/producao/filamento), loga o delta — mesmo padrão do
//    ajustes_manuais_estoque usado na aba Estoque.
// 5) compras_filamento — entrada de estoque quando um pedido de compra é
//    lançado na aba Financeiro (ver POST
//    /api/financeiro/compras-filamento). Pedido do Guilherme em
//    2026-07-28: "esse numero tem que mudar, e o filamento ser
//    adicionado em salvar estoque de filamento" — antes a compra só
//    alimentava o custo médio, sem entrar no saldo; agora soma direto,
//    então precisa aparecer aqui como entrada (+).
// ?limit=N — pedido do Guilherme em 2026-07-29 (aba Relatórios): o
// histórico embutido na aba Estoque só precisa das últimas ~100
// movimentações, mas o relatório completo (com exportação pra Excel)
// precisa de TUDO que já aconteceu, não só o topo. Sem o parâmetro,
// mantém o comportamento antigo (100) pra não mudar nada na aba
// Estoque; com ?limit=5000 (usado pela aba Relatórios) sobe bem mais.
export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 5000) : 100;

  const producoesConcluidas = (await sql`
    SELECT p.id, p.concluido_em AS data, p.quantidade_placas,
           pl.nome AS placa_nome, pl.peso_placa_gramas
    FROM producoes p
    JOIN placas pl ON pl.id = p.placa_id
    WHERE p.status = 'concluida' AND pl.peso_placa_gramas IS NOT NULL
    ORDER BY p.concluido_em DESC
    LIMIT ${limit}
  `) as {
    id: number;
    data: string;
    quantidade_placas: string;
    placa_nome: string;
    peso_placa_gramas: string;
  }[];

  const producoesFalha = (await sql`
    SELECT p.id, p.concluido_em AS data, p.gramas_desperdicadas, pl.nome AS placa_nome
    FROM producoes p
    JOIN placas pl ON pl.id = p.placa_id
    WHERE p.status = 'falha_placa' AND p.gramas_desperdicadas > 0
    ORDER BY p.concluido_em DESC
    LIMIT ${limit}
  `) as { id: number; data: string; gramas_desperdicadas: string; placa_nome: string }[];

  const perdasAvulsas = (await sql`
    SELECT cor, gramas, motivo, criado_em AS data
    FROM perdas_filamento_manual
    ORDER BY criado_em DESC
    LIMIT ${limit}
  `) as { cor: string; gramas: number; motivo: string | null; data: string }[];

  await sql`
    CREATE TABLE IF NOT EXISTS ajustes_manuais_filamento (
      id SERIAL PRIMARY KEY,
      cor TEXT NOT NULL,
      delta NUMERIC NOT NULL,
      resultante NUMERIC NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  const ajustesManuais = (await sql`
    SELECT cor, delta, resultante, criado_em AS data
    FROM ajustes_manuais_filamento
    ORDER BY criado_em DESC
    LIMIT ${limit}
  `) as { cor: string; delta: string; resultante: string; data: string }[];

  const compras = (await sql`
    SELECT cor, gramas, fornecedor, data_compra AS data
    FROM compras_filamento
    ORDER BY data_compra DESC, id DESC
    LIMIT ${limit}
  `) as { cor: string; gramas: string; fornecedor: string | null; data: string }[];

  type Movimento = {
    data: string;
    cor: string;
    tipo: "producao" | "falha" | "perda_avulsa" | "ajuste_manual" | "compra";
    gramas: number;
    detalhe: string;
  };

  const movimentos: Movimento[] = [];

  for (const p of producoesConcluidas) {
    const cor = corFilamentoDaPlaca(p.placa_nome);
    if (!cor) continue;
    const gramas = Number(p.quantidade_placas) * Number(p.peso_placa_gramas);
    if (gramas <= 0) continue;
    movimentos.push({
      data: p.data,
      cor,
      tipo: "producao",
      gramas: -gramas,
      detalhe: `Produção #${p.id} concluída — ${p.placa_nome} (${p.quantidade_placas} placa(s))`,
    });
  }

  for (const p of producoesFalha) {
    const cor = corFilamentoDaPlaca(p.placa_nome);
    if (!cor) continue;
    const gramas = Number(p.gramas_desperdicadas);
    if (gramas <= 0) continue;
    movimentos.push({
      data: p.data,
      cor,
      tipo: "falha",
      gramas: -gramas,
      detalhe: `Falha na placa #${p.id} — ${p.placa_nome}`,
    });
  }

  for (const perda of perdasAvulsas) {
    movimentos.push({
      data: perda.data,
      cor: perda.cor,
      tipo: "perda_avulsa",
      gramas: -perda.gramas,
      detalhe: perda.motivo ? `Perda avulsa — ${perda.motivo}` : "Perda avulsa",
    });
  }

  for (const a of ajustesManuais) {
    movimentos.push({
      data: a.data,
      cor: a.cor,
      tipo: "ajuste_manual",
      gramas: Number(a.delta),
      detalhe: `Ajuste manual do estoque (ficou em ${Number(a.resultante)}g)`,
    });
  }

  for (const c of compras) {
    const gramas = Number(c.gramas);
    if (gramas <= 0) continue;
    movimentos.push({
      data: c.data,
      cor: c.cor,
      tipo: "compra",
      gramas,
      detalhe: c.fornecedor ? `Compra registrada — ${c.fornecedor}` : "Compra registrada",
    });
  }

  movimentos.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());

  return NextResponse.json({ movimentos: movimentos.slice(0, limit) });
}
