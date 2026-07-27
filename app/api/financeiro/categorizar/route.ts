import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from "@/lib/financeiro";
import { categoriasHistoricas, historicoFornecedor, mesclarCategorias } from "@/lib/financeiro-categorias";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Sugestão automática de categoria — pedido do Guilherme em 2026-07-27:
// "Categoria deve ser analisada pela Ia nao eu ter que preencher." No
// lançamento manual, o usuário só digita a descrição (e opcionalmente
// fornecedor/valor); essa rota usa a IA pra classificar dentro da lista
// fixa de categorias — o campo Categoria no front continua editável caso
// a IA erre, mas não é mais obrigatório escolher/digitar na mão.
//
// Atualizado no mesmo dia — pedido: "a IA deve separar a categoria... e
// sempre ir aprendendo com os fornecedores, descricao e ir organizando de
// forma mais clara." Duas mudanças: (1) a lista de categorias oferecida
// pra IA agora é a lista fixa UNIDA com as categorias que já foram
// realmente usadas no histórico (ex: "Impressora", "Investimento",
// "Venda" — que o Guilherme já vinha digitando na mão e não existiam na
// lista fixa) — assim o sistema aprende e reaproveita o que já foi
// consolidado em vez de forçar tudo em "Outros"; (2) se o fornecedor
// bater com lançamentos anteriores, os últimos 5 (descrição → categoria)
// entram no prompt como exemplo, pra manter consistência por fornecedor.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const tipo = body.tipo === "receita" ? "receita" : "despesa";
  const descricao = String(body.descricao ?? "").trim();
  const fornecedor = body.fornecedor ? String(body.fornecedor).trim() : null;
  const valor = typeof body.valor === "number" && Number.isFinite(body.valor) ? body.valor : null;

  if (!descricao) {
    return NextResponse.json({ error: "Informe uma descrição." }, { status: 400 });
  }

  const opcoesFixas: readonly string[] = tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;
  const [historicas, historico] = await Promise.all([
    categoriasHistoricas(tipo),
    fornecedor ? historicoFornecedor(tipo, fornecedor) : Promise.resolve([]),
  ]);
  const opcoes = mesclarCategorias(opcoesFixas, historicas);

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
            `exato de uma delas): ${opcoes.join(", ")}. Priorize reaproveitar uma categoria que já ` +
            "existe na lista (o usuário já vem usando essas ao longo do tempo) em vez de inventar uma " +
            'variação nova; só use "Outros" se nada da lista fizer sentido.\n\n' +
            (historico.length
              ? "Histórico de lançamentos anteriores desse mesmo fornecedor (mais recentes primeiro, " +
                "use como referência de como esse fornecedor costuma ser categorizado):\n" +
                historico.map((h) => `- "${h.descricao}" → categoria "${h.categoria}"`).join("\n") +
                "\n\n"
              : "") +
            `Tipo: ${tipo}\n` +
            `Descrição: ${descricao}\n` +
            (fornecedor ? `Fornecedor/cliente: ${fornecedor}\n` : "") +
            (valor !== null ? `Valor: R$ ${valor}\n` : ""),
        },
      ],
    });

    const bruta = object.categoria.trim();
    const encontrada = opcoes.find((o) => o.toLowerCase() === bruta.toLowerCase());
    const categoria = encontrada ?? bruta ?? (opcoes.includes("Outros") ? "Outros" : opcoes[0]);

    return NextResponse.json({ categoria });
  } catch (err) {
    console.error("Erro ao sugerir categoria com IA:", err);
    return NextResponse.json({ error: "Não deu pra sugerir a categoria." }, { status: 502 });
  }
}
