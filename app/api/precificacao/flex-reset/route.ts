import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// ROTA TEMPORARIA (13/11/2026) — aplica a media real do bonus Flex
// (R$ 8,99, valor definido pelo Guilherme) em todos os produtos marcados como Flex. Sera removida.
export async function POST() {
  const a = (await sql`
    UPDATE precificacao_produtos SET reembolso_flex_ml = 8.99, atualizado_em = now()
    WHERE enviado_por_flex_ml = true RETURNING produto_id
  `) as unknown[];
  const b = (await sql`
    UPDATE precificacao_sku_virtual SET reembolso_flex_ml = 8.99, atualizado_em = now()
    WHERE enviado_por_flex_ml = true RETURNING id
  `) as unknown[];
  return NextResponse.json({ produtos: a.length, virtuais: b.length });
}
