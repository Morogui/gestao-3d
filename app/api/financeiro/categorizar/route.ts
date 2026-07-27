import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from "@/lib/financeiro";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sugestão automática de categoria — pedido do Guilherme em 2026-07-27:
// "Categoria deve ser analisada pela Ia nao eu ter que preencher." No
// lançamento manual, o usuário só digita a descrição (e opcionalmente
// fornecedor/valor); essa rota usa a IA pra classificar dentro da lista
// fixa de categorias — o campo Categoria no front continua editável caso
// a IA erre, mas não é mais obrigatório escolher/digitar na mão.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const tipo = body.tipo === "receita" ? "receita" : "despesa";
  const descricao = String(body.descricao ?? "").trim();
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;
  const valor = typeof body.valor === "number" && Number.isFinite(body.valor) ? body.valor : null;

  if (!descricao) {
    return NextResponse.json({ error: "Informe uma descrição." }, { status: 400 });
  }

  const opcoes: readonly string[] = tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;

  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: z.object({
        categoria: z
          .string()
          .describe(`Categoria mais adequada, escolhendo SOMENTE uma destas opções: ${opcoes.join(", ")}`),
      }),
      messages: [
        {
          role: "user",
          content:
            "Você é o assistente financeiro de uma pequena empresa de impressão 3D e marketplace " +
            "(Shopee/Mercado Livre/TikTok Shop). Classifique esse lançamento na categoria mais " +
            "adequada, escolhendo SOMENTE uma das opções da lista a seguir (responda com o texto " +
            `exato de uma delas): ${opcoes.join(", ")}.\n\n` +
            `Tipo: ${tipo}\n` +
            `Descrição: ${descricao}\n` +
            (fornecedor ? `Fornecedor/cliente: ${fornecedor}\n` : "") +
            (valor !== null ? `Valor: R$ ${valor}\n` : ""),
        },
      ],
    });

    const bruta = object.categoria.trim();
    const encontrada = opcoes.find((o) => o.toLowerCase() === bruta.toLowerCase());
    const categoria = encontrada ?? (opcoes.includes("Outros") ? "Outros" : opcoes[0]);

    return NextResponse.json({ categoria });
  } catch (err) {
    console.error("Erro ao sugerir categoria com IA:", err);
    return NextResponse.json({ error: "Não deu pra sugerir a categoria." }, { status: 502 });
  }
}
