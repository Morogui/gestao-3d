import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from "@/lib/financeiro";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Separar lançamento em itens — pedido do Guilherme em 2026-07-27: ele
// colou numa única descrição um pagamento que na verdade juntava vários
// produtos de embalagem com preços individuais (ex: "SHPP Brasil - 40,11
// (Caixa papelao 18x13x9) 50un -73,84 2 rolo de bolha -126,84 Fita dupla
// face 2000un -29,07 10 caixa papelao full 30x20x20", total R$269,86) e
// isso saiu com categoria errada ("Taxas de marketplace" em vez de
// "Embalagem"). Essa rota lê o texto solto, identifica cada produto/valor
// e devolve uma lista de itens já categorizados individualmente — se não
// achar múltiplos itens, devolve só 1 (mesma descrição/categoria de
// antes, só que já classificada certinha).
export async function POST(request: NextRequest) {
  const body = await request.json();
  const tipo = body.tipo === "receita" ? "receita" : "despesa";
  const descricao = String(body.descricao ?? "").trim();
  const valorTotal =
    typeof body.valorTotal === "number" && Number.isFinite(body.valorTotal) ? body.valorTotal : null;

  if (!descricao) {
    return NextResponse.json({ error: "Informe uma descrição." }, { status: 400 });
  }

  const opcoes: readonly string[] = tipo === "receita" ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA;

  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: z.object({
        itens: z
          .array(
            z.object({
              descricao: z.string().describe("Descrição curta e específica desse item (o que foi comprado/recebido)"),
              valor: z.number().describe("Valor em reais desse item específico"),
              categoria: z
                .string()
                .describe(`Categoria desse item, escolhendo SOMENTE uma destas opções: ${opcoes.join(", ")}`),
            })
          )
          .min(1)
          .describe(
            "Lista de itens identificados no texto. Se o texto descreve vários produtos/valores " +
              "concatenados numa única compra (comum quando alguém cola o extrato de um comprovante " +
              "com várias linhas de produto num campo só), separe cada produto em um item com seu " +
              "próprio valor e categoria. Se o texto descreve só uma coisa, devolva um único item."
          ),
      }),
      messages: [
        {
          role: "user",
          content:
            "Você é o assistente financeiro de uma pequena empresa de impressão 3D e marketplace " +
            "(Shopee/Mercado Livre/TikTok Shop). O usuário colou o texto de um lançamento financeiro " +
            "que pode conter vários produtos e valores individuais misturados numa frase só (às vezes " +
            "vindo direto de um comprovante de compra com várias linhas de produto, tipo caixas, fitas, " +
            "plástico bolha etc. de embalagem). Sua tarefa: separar em itens distintos, cada um com " +
            "descrição curta e específica, valor individual e categoria — escolhendo SOMENTE uma das " +
            `opções da lista: ${opcoes.join(", ")}.\n\n` +
            `Tipo: ${tipo}\n` +
            `Texto da descrição: ${descricao}\n` +
            (valorTotal !== null
              ? `Valor total pago nesse lançamento (a soma dos valores dos itens deve bater com esse total, se possível): R$ ${valorTotal}\n`
              : ""),
        },
      ],
    });

    const itens = object.itens.map((item) => {
      const bruta = item.categoria.trim();
      const encontrada = opcoes.find((o) => o.toLowerCase() === bruta.toLowerCase());
      return {
        descricao: item.descricao.trim(),
        valor: item.valor,
        categoria: encontrada ?? (opcoes.includes("Outros") ? "Outros" : opcoes[0]),
      };
    });

    return NextResponse.json({ itens });
  } catch (err) {
    console.error("Erro ao separar itens com IA:", err);
    return NextResponse.json({ error: "Não deu pra separar os itens." }, { status: 502 });
  }
}
