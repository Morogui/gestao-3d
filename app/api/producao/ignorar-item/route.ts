import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { chaveItemIgnorado } from "@/lib/demanda";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const body = await req.json();
    const titulo = String(body.titulo ?? "").trim();
    const sku = String(body.sku ?? "").trim();

    if (!titulo) {
          return NextResponse.json({ error: "Informe o titulo do item." }, { status: 400 });
        }

    const chave = chaveItemIgnorado(sku, titulo);
    if (!chave) {
          return NextResponse.json({ error: "Nao deu pra gerar uma chave pra esse item." }, { status: 400 });
        }

    await sql`
      INSERT INTO itens_demanda_ignorados (chave, titulo, sku)
      VALUES (${chave}, ${titulo}, ${sku || null})
      ON CONFLICT (chave) DO NOTHING
    `;

    return NextResponse.json({ ok: true });
  }

export async function GET() {
    const rows = await sql`
      SELECT id, chave, titulo, sku, criado_em FROM itens_demanda_ignorados
      ORDER BY criado_em DESC
    `;
    return NextResponse.json(rows);
  }

export async function DELETE(req: NextRequest) {
    const body = await req.json();
    const id = Number(body.id);
    if (!id) {
          return NextResponse.json({ error: "Informe o id." }, { status: 400 });
        }
    await sql`DELETE FROM itens_demanda_ignorados WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  }
