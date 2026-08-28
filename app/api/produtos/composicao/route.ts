import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Tela editavel da aba "Produtos" -- pedido do Guilherme em 2026-08-28:
// "Tela editavel na aba de produtos". Ate aqui app/produtos/page.tsx so
// lia sku_placa (via /api/produtos/catalogo); esta rota e quem permite
// de fato criar/editar/remover as linhas de composicao (SKU -> placa +
// pecas por unidade) direto pela tela, sem precisar de script manual.

interface ComposicaoBody {
  sku?: string;
  placaId?: number;
  pecasPorUnidade?: number;
}

function validarEntrada(body: ComposicaoBody) {
  const sku = (body.sku ?? "").trim();
  const placaId = Number(body.placaId);
  const pecas = Number(body.pecasPorUnidade);

  if (!sku) return { erro: "sku e obrigatorio" as const };
  if (!Number.isInteger(placaId) || placaId <= 0)
    return { erro: "placaId invalido" as const };
  if (!Number.isFinite(pecas) || pecas <= 0)
    return { erro: "pecasPorUnidade deve ser maior que zero" as const };

  return { sku, placaId, pecas };
}

// Cria ou atualiza uma linha de composicao -- upsert manual (sem depender
// de constraint UNIQUE no banco, que nao sabemos se existe pra
// (sku, placa_id) nesta tabela legada).
export async function POST(request: NextRequest) {
  const body = (await request.json()) as ComposicaoBody;
  const entrada = validarEntrada(body);
  if ("erro" in entrada) {
    return NextResponse.json({ error: entrada.erro }, { status: 400 });
  }
  const { sku, placaId, pecas } = entrada;

  const placaRows = await sql`SELECT id FROM placas WHERE id = ${placaId}`;
  if (placaRows.length === 0) {
    return NextResponse.json({ error: "placa nao encontrada" }, { status: 404 });
  }

  const existente = await sql`
    SELECT 1 FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placaId}
  `;

  if (existente.length > 0) {
    await sql`
      UPDATE sku_placa
      SET pecas_por_unidade = ${pecas}
      WHERE sku = ${sku} AND placa_id = ${placaId}
    `;
  } else {
    await sql`
      INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
      VALUES (${sku}, ${placaId}, ${pecas})
    `;
  }

  return NextResponse.json({ ok: true });
}

// Remove uma linha de composicao especifica (sku + placa). Se placaId
// nao for informado, remove TODAS as linhas daquele sku (exclui o
// produto inteiro do catalogo de composicao).
export async function DELETE(request: NextRequest) {
  const body = (await request.json()) as ComposicaoBody;
  const sku = (body.sku ?? "").trim();
  if (!sku) {
    return NextResponse.json({ error: "sku e obrigatorio" }, { status: 400 });
  }

  if (body.placaId !== undefined && body.placaId !== null) {
    const placaId = Number(body.placaId);
    if (!Number.isInteger(placaId) || placaId <= 0) {
      return NextResponse.json({ error: "placaId invalido" }, { status: 400 });
    }
    await sql`DELETE FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placaId}`;
  } else {
    await sql`DELETE FROM sku_placa WHERE sku = ${sku}`;
  }

  return NextResponse.json({ ok: true });
}
