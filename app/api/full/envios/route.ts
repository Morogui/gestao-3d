import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { todaySP } from "@/lib/date";
import {
  calcularViabilidade,
  janelaAprendida,
  maquinasAtivas,
} from "@/lib/capacidade";

export const dynamic = "force-dynamic";

// Coluna adicionada em 2026-07-29 — pedido do Guilherme: produtos
// compostos (Suporte Universal, Suporte Carro, Suporte BMW etc., que
// precisam de 1 placa "Corpos" + 1 placa "Ganchos" pra fechar 1 unidade
// vendida) agora criam VÁRIOS envios de uma vez (um por placa
// componente — ver POST abaixo e criarEnvio em app/full/page.tsx), mas
// precisam continuar aparecendo como UMA linha só na tela ("mostrar só
// a SKU principal"), com Editar/Confirmar/Excluir agindo em todos os
// componentes juntos. grupo_id é o elo entre essas linhas: mesmo valor
// pra todas as placas criadas na mesma ação de "Adicionar envio";
// null/vazio pra envios de placa única (a maioria), que continuam
// tratados como grupo de 1 (usa o próprio id).
async function garantirColunaGrupo() {
  await sql`ALTER TABLE full_envios ADD COLUMN IF NOT EXISTS grupo_id TEXT`;
}

// Coluna adicionada em 2026-07-31 — bug real encontrado pelo Guilherme:
// "dei baixa agora em 10 unidades do Box 6mm branco e ele não deu baixa
// de 30un do meu estoque". Causa raiz: "3 SUPORTE BOX 6MM BRANCO" é um
// SKU de KIT (o catálogo sku_placa tem pecas_por_unidade=3 pra esse SKU
// específico — 10 unidades vendidas = 30 peças físicas da placa), mas
// full_envios.quantidade sempre guardou o número de UNIDADES DO SKU
// (kits), não de peças, e tanto a confirmação (PATCH /[id]) quanto o
// cálculo de faltantePlaca aqui embaixo tratavam esse número como se já
// fosse peças — corretos só por coincidência quando pecas_por_unidade=1
// (a maioria dos produtos, sem kit). Essa coluna guarda o multiplicador
// exato do SKU escolhido (vem de sku_placa.pecas_por_unidade, capturado
// no momento de "Adicionar envio" — ver POST abaixo e criarEnvio em
// app/full/page.tsx), pra converter unidades→peças em todo lugar que
// precisar. Default 1 preserva o comportamento de sempre pros ~99% dos
// SKUs sem kit.
async function garantirColunaPecasPorUnidade() {
  await sql`ALTER TABLE full_envios ADD COLUMN IF NOT EXISTS pecas_por_unidade INTEGER NOT NULL DEFAULT 1`;
  // Autocorreção pra envios PENDENTES já cadastrados antes dessa coluna
  // existir (ainda não confirmados, então ainda dá pra corrigir sem
  // mexer em estoque nenhum) — casa pelo mesmo par (sku, placa_id) usado
  // na hora de criar o envio contra o catálogo real (sku_placa). Não
  // toca em envios já confirmados (a baixa de estoque deles já aconteceu
  // com o número antigo; corrigir isso é ação manual separada).
  await sql`
    UPDATE full_envios fe
    SET pecas_por_unidade = sp.pecas_por_unidade
    FROM sku_placa sp
    WHERE sp.sku = fe.sku AND sp.placa_id = fe.placa_id
      AND fe.pecas_por_unidade = 1
      AND sp.pecas_por_unidade != 1
      AND fe.status = 'pendente'
  `;
}

async function garantirColunaTituloMl() {
  await sql`ALTER TABLE full_envios ADD COLUMN IF NOT EXISTS titulo_ml TEXT`;
}

// Envios planejados do Full — pedido do Guilherme em 2026-07-25: "uma
// aba onde vou subir meu envio e a data que eu tenho para enviar esse
// produto... valida em estoque se tenho a quantidade dos produtos a
// serem enviadas até aquela data, se não tiver essa quantidade, gera uma
// ordem de produção extraordinária de prioridade". Cada linha aqui é um
// envio planejado (SKU + quantidade + data limite); a fila de
// prioridade da aba Produção (critério nº-2, ANTES até do backlog de
// despacho) usa "faltantePlaca" pra saber se precisa furar a fila.
export interface FullEnvioRow {
  id: number;
  sku: string;
  placaId: number;
  placaNome: string;
  quantidade: number;
  dataLimite: string;
  status: "pendente" | "confirmado" | "cancelado";
  criadoEm: string;
  confirmadoEm: string | null;
  // Ver garantirColunaGrupo() acima — null pra envios de placa única.
  grupoId: string | null;
  // Ver garantirColunaPecasPorUnidade() acima — multiplicador do SKU
  // (1 pra maioria dos produtos; >1 só pra SKUs de kit, ex: "3 SUPORTE
  // BOX 6MM BRANCO" = 3). quantidade × pecasPorUnidade = peças físicas
  // reais que esse envio representa.
  pecasPorUnidade: number;
  // Quanto falta produzir pra cobrir TODOS os envios ainda pendentes
  // dessa mesma placa (soma das quantidades × pecasPorUnidade, em
  // PEÇAS), descontando estoque atual + o que já está em produção
  // agora. Mesmo valor em todas as linhas que compartilham a placa — é
  // isso que vira prioridade extraordinária na aba Produção. Nunca
  // negativo.
  faltantePlaca: number;
  // Checagem de viabilidade — pedido do Guilherme em 2026-07-29: "conferir
  // a possibilidade para produção sem comprometer mais de 50% da minha
  // linha de produção". Ver lib/capacidade.ts pro cálculo completo
  // (horas necessárias pra imprimir faltantePlaca × capacidade teórica
  // das máquinas ativas entre hoje e dataLimite).
  horasNecessarias: number;
  capacidadeDisponivelHoras: number;
  percentualComprometido: number;
  aprovado: boolean;
}

export async function GET() {
  await garantirColunaGrupo();
  await garantirColunaPecasPorUnidade();
  await garantirColunaTituloMl();

  const envios = (await sql`
    SELECT fe.id, fe.sku, fe.placa_id, pl.nome AS placa_nome, fe.quantidade,
      fe.data_limite, fe.status, fe.criado_em, fe.confirmado_em, fe.grupo_id,
      fe.pecas_por_unidade, fe.titulo_ml
    FROM full_envios fe
    JOIN placas pl ON pl.id = fe.placa_id
    WHERE fe.status != 'cancelado'
    ORDER BY fe.data_limite ASC, fe.criado_em ASC
  `) as {
    id: number;
    sku: string;
    placa_id: number;
    placa_nome: string;
    quantidade: number;
    data_limite: string;
    status: string;
    criado_em: string;
    confirmado_em: string | null;
    grupo_id: string | null;
    pecas_por_unidade: number;
    titulo_ml: string | null;
  }[];

  if (envios.length === 0) {
    return NextResponse.json([]);
  }

  const placaIds = Array.from(new Set(envios.map((e) => e.placa_id)));

  const placasInfoRows = (await sql`
    SELECT id, pecas_por_placa, tempo_placa_horas FROM placas WHERE id = ANY(${placaIds})
  `) as { id: number; pecas_por_placa: string; tempo_placa_horas: string }[];
  const placaInfoPorId = new Map(
    placasInfoRows.map((r) => [
      r.id,
      { pecasPorPlaca: Number(r.pecas_por_placa), tempoPlacaHoras: Number(r.tempo_placa_horas) },
    ])
  );

  const [janela, numMaquinasAtivas] = await Promise.all([
    janelaAprendida(),
    maquinasAtivas(),
  ]);
  const hoje = todaySP();

  const estoqueRows = (await sql`
    SELECT placa_id, quantidade_pecas FROM estoque_placas WHERE placa_id = ANY(${placaIds})
  `) as { placa_id: number; quantidade_pecas: number }[];
  const estoquePorPlaca = new Map(estoqueRows.map((r) => [r.placa_id, Number(r.quantidade_pecas)]));

  const emProducaoRows = (await sql`
    SELECT pr.placa_id, pr.quantidade_placas, pl.pecas_por_placa
    FROM producoes pr
    JOIN placas pl ON pl.id = pr.placa_id
    WHERE pr.status = 'em_andamento' AND pr.placa_id = ANY(${placaIds})
  `) as { placa_id: number; quantidade_placas: number; pecas_por_placa: number }[];
  const emProducaoPorPlaca = new Map<number, number>();
  for (const r of emProducaoRows) {
    const pecas = Number(r.quantidade_placas) * Number(r.pecas_por_placa);
    emProducaoPorPlaca.set(r.placa_id, (emProducaoPorPlaca.get(r.placa_id) ?? 0) + pecas);
  }

  const pendentePorPlaca = new Map<number, number>();
  for (const e of envios) {
    if (e.status !== "pendente") continue;
    // Ver garantirColunaPecasPorUnidade() — quantidade é em UNIDADES do
    // SKU, não em peças; multiplica pelo pecas_por_unidade do SKU (1 na
    // maioria dos casos, >1 só pra kits) pra somar peças de verdade.
    const pecas = Number(e.quantidade) * Number(e.pecas_por_unidade ?? 1);
    pendentePorPlaca.set(e.placa_id, (pendentePorPlaca.get(e.placa_id) ?? 0) + pecas);
  }

  function faltantePlaca(placaId: number): number {
    const estoqueProjetado = (estoquePorPlaca.get(placaId) ?? 0) + (emProducaoPorPlaca.get(placaId) ?? 0);
    const pendente = pendentePorPlaca.get(placaId) ?? 0;
    return Math.max(0, pendente - estoqueProjetado);
  }

  // A coluna é DATE, mas o driver da Neon devolve isso como um objeto Date
  // nativo do JS (não uma string) — String(dateObj) vira algo tipo
  // "Sat Jul 25 2026 00:00:00 GMT+0000", e um simples .slice(0,10) pegava
  // "Sat Jul 25" (errado). Aqui lemos os componentes em UTC (a DATE não
  // tem timezone, o driver monta o Date à meia-noite UTC) e montamos
  // "YYYY-MM-DD" manualmente — mesmo formato usado em
  // todaySP()/formatDiaBR em lib/date.ts. Também cobre o caso de já vir
  // como string ISO.
  function toPlainDate(v: unknown): string {
    if (v instanceof Date) {
      const y = v.getUTCFullYear();
      const m = String(v.getUTCMonth() + 1).padStart(2, "0");
      const d = String(v.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(v).slice(0, 10);
  }

  const resultado: FullEnvioRow[] = envios.map((e) => {
    const dataLimite = toPlainDate(e.data_limite);
    const faltante = faltantePlaca(e.placa_id);
    const info = placaInfoPorId.get(e.placa_id) ?? { pecasPorPlaca: 0, tempoPlacaHoras: 0 };
    const viabilidade = calcularViabilidade(
      faltante,
      info.pecasPorPlaca,
      info.tempoPlacaHoras,
      hoje,
      dataLimite,
      numMaquinasAtivas,
      janela
    );

    return {
      id: e.id,
      sku: e.sku,
      placaId: e.placa_id,
      placaNome: e.placa_nome,
      quantidade: Number(e.quantidade),
      dataLimite,
      status: e.status as FullEnvioRow["status"],
      criadoEm: e.criado_em,
      confirmadoEm: e.confirmado_em,
      faltantePlaca: faltante,
      horasNecessarias: viabilidade.horasNecessarias,
      capacidadeDisponivelHoras: viabilidade.capacidadeDisponivelHoras,
      percentualComprometido: viabilidade.percentualComprometido,
      aprovado: viabilidade.aprovado,
      grupoId: e.grupo_id,
      pecasPorUnidade: Number(e.pecas_por_unidade ?? 1),
      tituloMl: e.titulo_ml,
    };
  });

  return NextResponse.json(resultado);
}

// Cria um novo envio planejado do Full (data + SKU + quantidade).
export async function POST(request: NextRequest) {
  await garantirColunaGrupo();
  await garantirColunaPecasPorUnidade();
  await garantirColunaTituloMl();

  const body = await request.json();
  const sku = String(body.sku ?? "").trim();
  const placaId = Number(body.placaId);
  const quantidade = Number(body.quantidade);
  const dataLimite = String(body.dataLimite ?? "").trim();
  // Ver garantirColunaGrupo() acima. Opcional — o front só manda isso
  // quando o SKU escolhido tem mais de uma placa componente, pra ligar
  // as linhas criadas juntas na mesma ação de "Adicionar envio".
  const grupoId = body.grupoId ? String(body.grupoId).trim() : null;
  const tituloMl = body.tituloMl ? String(body.tituloMl).trim() : null;
  // Ver garantirColunaPecasPorUnidade() acima. Opcional (default 1) —
  // o front manda o pecas_por_unidade exato do SKU escolhido (vem de
  // /api/skus, que já lê isso de sku_placa), pra converter unidades→peças
  // corretamente na hora de confirmar o envio e no cálculo de falta
  // produzir. SKUs sem kit (a maioria) continuam em 1.
  const pecasPorUnidadeBody = body.pecasPorUnidade !== undefined ? Number(body.pecasPorUnidade) : 1;
  const pecasPorUnidade =
    Number.isFinite(pecasPorUnidadeBody) && pecasPorUnidadeBody > 0 ? pecasPorUnidadeBody : 1;

  if (!sku || !placaId || !quantidade || quantidade <= 0 || !dataLimite) {
    return NextResponse.json(
      { error: "Informe sku, placaId, quantidade (> 0) e dataLimite." },
      { status: 400 }
    );
  }

  const rows = await sql`
    INSERT INTO full_envios (sku, placa_id, quantidade, data_limite, status, grupo_id, pecas_por_unidade, titulo_ml)
    VALUES (${sku}, ${placaId}, ${quantidade}, ${dataLimite}, 'pendente', ${grupoId}, ${pecasPorUnidade}, ${tituloMl})
    RETURNING id
  `;

  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
