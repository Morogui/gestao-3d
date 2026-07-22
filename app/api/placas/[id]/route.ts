import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Atualiza o peso de filamento gasto por placa (gramas) — usado pra
// calcular "quanto já foi impresso" na aba Produção. Por enquanto só
// esse campo é editável por aqui; os demais dados da placa (peças/placa,
// tempo/placa etc.) continuam vindo só da importação do catálogo.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const { pesoPlacaGramas } = body as { pesoPlacaGramas?: number | null };

  if (
    pesoPlacaGramas !== null &&
    pesoPlacaGramas !== undefined &&
    (!Number.isFinite(pesoPlacaGramas) || pesoPlacaGramas < 0)
  ) {
    return NextResponse.json(
      { error: "pesoPlacaGramas precisa ser um número >= 0 (ou null)" },
      { status: 400 }
    );
  }

  const rows = (await sql`
    UPDATE placas
    SET peso_placa_gramas = ${pesoPlacaGramas ?? null}
    WHERE id = ${id}
    RETURNING id, peso_placa_gramas
  `) as { id: number; peso_placa_gramas: string | null }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "placa não encontrada" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
