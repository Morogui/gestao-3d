// Rota temporaria de diagnostico -- pedido do Guilherme em 2026-08-18:
// "monte uma aba de precificacao... o ml calcula peso cubagem". Antes de
// construir a aba nova, preciso confirmar como o ML calcula a tarifa
// variavel por peso/dimensao hoje (mudou em 2/marco/2026, substituindo a
// taxa fixa antiga de R$6,75). A API publica (api.mercadolibre.com sem
// token) esta bloqueando toda chamada direta do navegador com
// PA_UNAUTHORIZED_RESULT_FROM_POLICIES -- entao testamos aqui, server-side,
// com o token OAuth ja salvo (lib/ml-auth.ts), usando itens reais do
// catalogo pra ver a resposta de tarifa/frete de verdade.
// Rota de uso unico -- remover depois de confirmar os dados.
import { NextResponse } from "next/server";
import { getValidMLAccessToken } from "@/lib/ml-auth";

export const dynamic = "force-dynamic";

async function chamarML(path: string, token: string) {
    try {
          const res = await fetch(`https://api.mercadolibre.com${path}`, {
                  headers: { Authorization: `Bearer ${token}` },
          });
          const text = await res.text();
          let data: unknown;
          try {
                  data = JSON.parse(text);
          } catch {
                  data = { raw: text.slice(0, 500) };
          }
          return { status: res.status, data };
    } catch (e) {
          return { status: 0, erro: String(e) };
    }
}

export async function GET() {
    const auth = await getValidMLAccessToken();
    if (!auth) {
          return NextResponse.json({ ok: false, erro: "ML nao conectado" }, { status: 400 });
    }
    const { accessToken, userId } = auth;

  const itemIds = [
        "MLB7025542046",
        "MLB6841541738",
        "MLB6843956794",
      ];

  const itens: Record<string, unknown> = {};
    for (const id of itemIds) {
          const item = await chamarML(`/items/${id}`, accessToken);
          const shipping = await chamarML(`/items/${id}/shipping_options`, accessToken);
          itens[id] = { item, shipping };
    }

  const listingPrices = await chamarML(
        `/sites/MLB/listing_prices?price=100&listing_type_id=gold_special`,
        accessToken
      );

  return NextResponse.json({ ok: true, userId, itens, listingPrices });
}
