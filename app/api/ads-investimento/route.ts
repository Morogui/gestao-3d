import { NextRequest, NextResponse } from "next/server";
import {
  getAdsInvestimentoDoDia,
  salvarAdsInvestimentoDoDia,
} from "@/lib/ads-investimento";

export const dynamic = "force-dynamic";

// GET /api/ads-investimento?dia=YYYY-MM-DD — devolve o que já foi
// lançado naquele dia (usado pra pré-preencher o formulário de registro
// na aba Vendas).
export async function GET(request: NextRequest) {
  const dia = request.nextUrl.searchParams.get("dia");
  if (!dia) {
    return NextResponse.json({ error: "parâmetro 'dia' é obrigatório" }, { status: 400 });
  }
  const valores = await getAdsInvestimentoDoDia(dia);
  return NextResponse.json(valores);
}

// POST { dia, ml, shopee } — registra/atualiza o investimento em Ads de
// um dia específico (lançamento manual, ver nota em lib/ads-investimento.ts
// sobre por que ainda não puxamos isso automaticamente das plataformas).
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { dia, ml, shopee } = body as { dia?: string; ml?: number; shopee?: number };
  if (!dia) {
    return NextResponse.json({ error: "'dia' é obrigatório" }, { status: 400 });
  }
  await salvarAdsInvestimentoDoDia(dia, Number(ml) || 0, Number(shopee) || 0);
  return NextResponse.json({ ok: true });
}
