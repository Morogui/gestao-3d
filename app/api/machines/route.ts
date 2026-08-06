import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await sql`
    SELECT id, nome, ativa FROM machines ORDER BY id ASC
  `;
  return NextResponse.json(rows);
}

// Cadastrar impressora nova — pedido do Guilherme em 2026-08-04: "estou
// comprando mais [impressoras] e se ficar pedindo pra você colocar toda
// hora vou perder tempo". Antes só dava pra adicionar uma máquina
// inserindo direto no banco (pedindo pra mim); agora é self-service pelo
// botão "+" na aba Produção (ver POST abaixo e PATCH em
// /api/machines/[id] pra renomear).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const nome = String(body.nome ?? "").trim();

  if (!nome) {
    return NextResponse.json({ error: "Informe um nome pra impressora." }, { status: 400 });
  }

  const rows = (await sql`
    INSERT INTO machines (nome, ativa)
    VALUES (${nome}, true)
    RETURNING id, nome, ativa
  `) as { id: number; nome: string; ativa: boolean }[];

  return NextResponse.json(rows[0]);
}
