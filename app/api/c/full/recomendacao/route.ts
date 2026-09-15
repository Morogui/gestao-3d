import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import { calcularRecomendacaoFull } from "@/lib/client-ml-orders";

export const dynamic = "force-dynamic";

// Recomendacao de envio Full pro cliente externo: soma as vendas Full
// reais (via MLB/item id, sem catalogo interno) num periodo escolhido
// (1 semana ou 15 dias) ate uma data, pra alimentar o botao "Planejar
// envio" em app/[cliente]/full/page.tsx. Pedido do Guilherme em
// 2026-09-15 -- ver lib/client-ml-orders.ts:calcularRecomendacaoFull.
export async function GET(req: NextRequest) {
    const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
    if (!sessao) {
          return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
    }

  const { searchParams } = new URL(req.url);
    const janelaParam = searchParams.get("janela");
    const ateParam = searchParams.get("ate");

  const janelaDias = janelaParam === "15" ? 15 : 7;
    const ate =
          ateParam && /^\d{4}-\d{2}-\d{2}$/.test(ateParam)
        ? ateParam
            : new Date().toISOString().slice(0, 10);

  const ateDate = new Date(`${ate}T12:00:00-03:00`);
    const fromDate = new Date(ateDate.getTime() - (janelaDias - 1) * 24 * 60 * 60 * 1000);
    const fromDay = fromDate.toISOString().slice(0, 10);

  const itens = await calcularRecomendacaoFull(sessao.clientId, fromDay, ate);
    if (itens === null) {
          return NextResponse.json(
            { error: "Mercado Livre nao conectado. Conecte a conta antes de gerar a recomendacao." },
            { status: 400 }
                );
    }

  return NextResponse.json({ itens, de: fromDay, ate, janelaDias });
}
