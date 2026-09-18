import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureCaixasTable, listarCaixas } from "@/lib/caixas";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureCaixasTable();
  const caixas = await listarCaixas();
  return NextResponse.json(caixas);
}

// Edição de preço/dimensões/peso de uma caixa já cadastrada (não cria
// caixa nova -- as 3 são fixas, seedadas em lib/caixas.ts). Útil pra
// quando o Guilherme pesar as caixas vazias ou o fornecedor mudar o
// preço.
export async function PUT(request: NextRequest) {
  await ensureCaixasTable();
  const body = await request.json();
  const { id, comprimentoCm, larguraCm, alturaCm, preco, pesoCaixaG, fornecedor, ativa } = body as {
    id: number;
    comprimentoCm?: number | null;
    larguraCm?: number | null;
    alturaCm?: number | null;
    preco?: number | null;
    pesoCaixaG?: number | null;
    fornecedor?: string | null;
    ativa?: boolean | null;
  };

  if (id == null) {
    return NextResponse.json({ error: "id e obrigatorio" }, { status: 400 });
  }

  await sql`
    UPDATE caixas_envio
    SET comprimento_cm = ${comprimentoCm ?? null},
        largura_cm = ${larguraCm ?? null},
        altura_cm = ${alturaCm ?? null},
        preco = ${preco ?? 0},
        peso_caixa_g = ${pesoCaixaG ?? null},
        fornecedor = ${fornecedor ?? null},
        ativa = ${ativa !== false},
        atualizado_em = now()
    WHERE id = ${id}
  `;

  return NextResponse.json({ ok: true });
}
