import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-08-04). Pedido do Guilherme: "Tivemos uma
// venda só Suporte Bwm Prata, e não pareceu para a produção, olhei aqui as
// placas e não temos o prata em cadastro ele segue a mesma linha do preto
// e branco!" — ou seja, o BMW passou a vender também na cor Prata, e essa
// cor simplesmente não existia em NENHUM lugar do catálogo (nem placa
// Mista, nem pool de gancho compartilhado, nem sku_placa), por isso a
// venda caiu direto em "não identificado" e nunca virou demanda/produção.
//
// Replica EXATAMENTE a mesma arquitetura já usada pro Branco/Preto do BMW
// (ver criar-suporte-bmw-mista + consolidar-gancho-compartilhado):
// 1. Cria a placa "Gancho Compartilhado - Universal/BMW/BYD (Prata)" —
//    pool novo, mesma peça física do gancho (10 pç/placa, 122,65g, 3h45,
//    tier A) que já existe pro Branco/Preto, só que ainda não tinha
//    variante Prata. Preparado pra ser compartilhado com Universal/BYD no
//    futuro, se algum dia venderem nessa cor também (mesma convenção de
//    nome/grupoComposto interno).
// 2. Cria "Suporte BMW - Mista (Prata)" com a MESMA arquitetura Mista do
//    Branco/Preto: papel='corpo' (credita 3 peças de corpo direto),
//    saída extra credita 2 peças de gancho no pool Prata recém-criado.
//    Peso/tempo: sem valor real informado pra Prata — usa o mesmo
//    309,2g/7h do Branco/Preto, já que é o mesmo molde físico, só muda a
//    cor do filamento (ajustar depois via PATCH /api/placas/[id] se o
//    peso real for diferente).
// 3. Registra "SUPORTE BMW PRATA" em sku_placa apontando pras DUAS placas
//    (Mista + pool), 1 peça cada — mesmo padrão exato de
//    "SUPORTE BMW BRANCO"/"PRETO" (o produto vendido é a montagem de 1
//    peça de corpo + 1 peça de gancho tirada do pool).
//
// Idempotente: usa nome/sku como chave de "já existe"; roda de novo sem
// duplicar nada.
const PESO_GANCHO_GRAMAS = 122.65;
const TEMPO_GANCHO_HORAS = 3.75;
const PECAS_POR_PLACA_GANCHO = 10;

const PESO_MISTA_GRAMAS = 309.2;
const TEMPO_MISTA_HORAS = 7;

export async function POST() {
  try {
    return await executar();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function proximoNumero(): Promise<number> {
  const rows = (await sql`
    SELECT COALESCE(MAX(numero), 0) AS max FROM placas
  `) as { max: number }[];
  return Number(rows[0].max) + 1;
}

async function executar() {
  const resultado: Record<string, unknown> = {};

  // 1) Pool de gancho compartilhado (Prata) — cria só se ainda não existir.
  const nomePool = "Gancho Compartilhado - Universal/BMW/BYD (Prata)";
  let poolRows = (await sql`SELECT id FROM placas WHERE nome = ${nomePool}`) as { id: number }[];
  let poolId: number;
  if (poolRows.length > 0) {
    poolId = poolRows[0].id;
    resultado.pool = { skip: true, motivo: "já existia", id: poolId };
  } else {
    const numero = await proximoNumero();
    const inserida = (await sql`
      INSERT INTO placas (
        numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
        frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
        descontinuada, peso_placa_gramas
      ) VALUES (
        ${numero}, ${nomePool}, 'composto', 'gancho', '__gancho_compartilhado_prata__',
        'GANCHO COMPARTILHADO (UNIVERSAL/BMW/BYD) PRATA', 'SUPORTE BMW PRATA',
        ${PECAS_POR_PLACA_GANCHO}, ${TEMPO_GANCHO_HORAS}, 'A', false, ${PESO_GANCHO_GRAMAS}
      )
      RETURNING id
    `) as { id: number }[];
    poolId = inserida[0].id;
    await sql`
      INSERT INTO estoque_placas (placa_id, quantidade_pecas) VALUES (${poolId}, 0)
      ON CONFLICT (placa_id) DO NOTHING
    `;
    resultado.pool = { criada: true, id: poolId };
  }

  // 2) Suporte BMW - Mista (Prata) — cria só se ainda não existir.
  const nomeMista = "Suporte BMW - Mista (Prata)";
  let mistaRows = (await sql`SELECT id FROM placas WHERE nome = ${nomeMista}`) as { id: number }[];
  let mistaId: number;
  if (mistaRows.length > 0) {
    mistaId = mistaRows[0].id;
    resultado.mista = { skip: true, motivo: "já existia", id: mistaId };
  } else {
    const numero = await proximoNumero();
    const inserida = (await sql`
      INSERT INTO placas (
        numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
        pecas_por_placa, tempo_placa_horas, tier, descontinuada,
        peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas
      ) VALUES (
        ${numero}, ${nomeMista}, 'composto', 'corpo', 'BMW-Prata', 'SUPORTE BMW PRATA',
        3, ${TEMPO_MISTA_HORAS}, 'C', false,
        ${PESO_MISTA_GRAMAS}, ${poolId}, 2
      )
      RETURNING id
    `) as { id: number }[];
    mistaId = inserida[0].id;
    await sql`
      INSERT INTO estoque_placas (placa_id, quantidade_pecas) VALUES (${mistaId}, 0)
      ON CONFLICT (placa_id) DO NOTHING
    `;
    resultado.mista = { criada: true, id: mistaId };
  }

  // 3) sku_placa: "SUPORTE BMW PRATA" -> pool + Mista, 1 peça cada (mesmo
  // padrão do Branco/Preto).
  const skuAlvos = [
    { placaId: poolId, label: "pool" },
    { placaId: mistaId, label: "mista" },
  ];
  const skuCriados: string[] = [];
  for (const alvo of skuAlvos) {
    const existente = (await sql`
      SELECT id FROM sku_placa WHERE sku = 'SUPORTE BMW PRATA' AND placa_id = ${alvo.placaId}
    `) as { id: number }[];
    if (existente.length > 0) continue;
    await sql`
      INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
      VALUES ('SUPORTE BMW PRATA', ${alvo.placaId}, 1)
    `;
    skuCriados.push(alvo.label);
  }
  resultado.skuPlaca = { criados: skuCriados };

  return NextResponse.json({ ok: true, poolId, mistaId, resultado });
}
