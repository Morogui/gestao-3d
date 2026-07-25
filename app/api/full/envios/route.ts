import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

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
  // Quanto falta produzir pra cobrir TODOS os envios ainda pendentes
  // dessa mesma placa (soma das quantidades), descontando estoque atual
  // + o que já está em produção agora. Mesmo valor em todas as linhas
  // que compartilham a placa — é isso que vira prioridade extraordinária
  // na aba Produção. Nunca negativo.
  faltantePlaca: number;
}

export async function GET() {
  const envios = (await sql`
    SELECT fe.id, fe.sku, fe.placa_id, pl.nome AS placa_nome, fe.quantidade,
      fe.data_limite, fe.status, fe.criado_em, fe.confirmado_em
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
  }[];

  if (envios.length === 0) {
    return NextResponse.json([]);
  }

  const placaIds = Array.from(new Set(envios.map((e) => e.placa_id)));

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
    pendentePorPlaca.set(e.placa_id, (pendentePorPlaca.get(e.placa_id) ?? 0) + Number(e.quantidade));
  }

  function faltantePlaca(placaId: number): number {
    const estoqueProjetado = (estoquePorPlaca.get(placaId) ?? 0) + (emProducaoPorPlaca.get(placaId) ?? 0);
    const pendente = pendentePorPlaca.get(placaId) ?? 0;
    return Math.max(0, pendente - estoqueProjetado);
  }

  const resultado: FullEnvioRow[] = envios.map((e) => ({
    id: e.id,
    sku: e.sku,
    placaId: e.placa_id,
    placaNome: e.placa_nome,
    quantidade: Number(e.quantidade),
    dataLimite: e.data_limite,
    status: e.status as FullEnvioRow["status"],
    criadoEm: e.criado_em,
    confirmadoEm: e.confirmado_em,
    faltantePlaca: faltantePlaca(e.placa_id),
  }));

  return NextResponse.json(resultado);
}

// Cria um novo envio planejado do Full (data + SKU + quantidade).
export async function POST(request: NextRequest) {
  const body = await request.json();
  const sku = String(body.sku ?? "").trim();
  const placaId = Number(body.placaId);
  const quantidade = Number(body.quantidade);
  const dataLimite = String(body.dataLimite ?? "").trim();

  if (!sku || !placaId || !quantidade || quantidade <= 0 || !dataLimite) {
    return NextResponse.json(
      { error: "Informe sku, placaId, quantidade (> 0) e dataLimite." },
      { status: 400 }
    );
  }

  const rows = await sql`
    INSERT INTO full_envios (sku, placa_id, quantidade, data_limite, status)
    VALUES (${sku}, ${placaId}, ${quantidade}, ${dataLimite}, 'pendente')
    RETURNING id
  `;

  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
