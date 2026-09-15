import { NextRequest, NextResponse } from "next/server";
import { verificarClientSessionNode } from "@/lib/client-session-server";
import {
  calcularRecomendacaoFull,
  MULTIPLICADORES_CURVA_DEFAULT,
  CurvaABC,
} from "@/lib/client-ml-orders";

export const dynamic = "force-dynamic";

// Recomendação de envio Full pro cliente externo: soma as vendas Full
// reais (via MLB/item id, sem catálogo interno) num período escolhido
// (1 semana ou 15 dias) até uma data, classifica cada item numa Curva
// ABC (80/15/5 por volume acumulado -- ver classificarCurvaABC em
// lib/client-ml-orders.ts) e aplica um multiplicador por curva em cima
// da quantidade base vendida. Pedido do Guilherme em 2026-09-15:
// "Curva A - multiplicado 1,4 - Curva B 1.1 - Curva C 1.0 (isso pode
// deixar editável na hora de planejar)" -- por isso os multiplicadores
// aceitam override via query string (multA/multB/multC), mas o valor
// default é o que veio nesse pedido.
export async function GET(req: NextRequest) {
  const sessao = verificarClientSessionNode(req.cookies.get("client_session")?.value);
  if (!sessao) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
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

  const itensBase = await calcularRecomendacaoFull(sessao.clientId, fromDay, ate);
  if (itensBase === null) {
    return NextResponse.json(
      { error: "Mercado Livre não conectado. Conecte a conta antes de gerar a recomendação." },
      { status: 400 }
    );
  }

  const parseMultiplicador = (param: string | null, padrao: number): number => {
    if (!param) return padrao;
    const valor = Number(param.replace(",", "."));
    return Number.isFinite(valor) && valor > 0 ? valor : padrao;
  };

  const multiplicadores: Record<CurvaABC, number> = {
    A: parseMultiplicador(searchParams.get("multA"), MULTIPLICADORES_CURVA_DEFAULT.A),
    B: parseMultiplicador(searchParams.get("multB"), MULTIPLICADORES_CURVA_DEFAULT.B),
    C: parseMultiplicador(searchParams.get("multC"), MULTIPLICADORES_CURVA_DEFAULT.C),
  };

  const itens = itensBase.map((item) => ({
    ...item,
    quantidadeRecomendada: Math.round(item.quantidadeBase * multiplicadores[item.curva]),
  }));

  return NextResponse.json({ itens, multiplicadores, de: fromDay, ate, janelaDias });
}
