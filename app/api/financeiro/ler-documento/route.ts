import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from "@/lib/financeiro";
import { categoriasHistoricas, mesclarCategorias } from "@/lib/financeiro-categorias";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Leitura automática de comprovante por IA — pedido do Guilherme em
// 2026-07-27: "um lugar onde consiga subir o arquivo do pagamento ou
// recebimento e apos subir esse arquivo, integrar uma IA pra fazer a
// leitura desse documento e listar ele como despesa". Usa o Vercel AI
// Gateway (pacote `ai`) com o modelo Claude — em produção na Vercel a
// autenticação é automática via OIDC (token injetado pela própria
// Vercel), sem precisar cadastrar uma API key manualmente.
//
// Importante: essa rota só EXTRAI os dados e devolve pro front revisar —
// não grava nada no banco (pedido do Guilherme: "pede confirmação antes
// de salvar"). O arquivo original (base64) volta na resposta pra não
// precisar subir de novo quando o usuário confirmar em
// POST /api/financeiro/lancamentos.
//
// Atualizado em 2026-07-27 — pedido: "a IA deve... sempre ir aprendendo
// com os fornecedores, descricao e ir organizando de forma mais clara."
// A lista de categorias oferecida pra IA agora é a lista fixa UNIDA com
// as categorias que já foram realmente usadas no histórico (via
// lib/financeiro-categorias) — como aqui ainda não sabemos o tipo
// (despesa/receita) antes da extração, buscamos o histórico dos dois e
// oferecemos a união. Por isso o schema virou uma função (precisa da
// lista carregada do banco antes de montar a description).
function construirSchemaExtracao(opcoesCategoria: string[]) {
  return z.object({
    tipo: z
      .enum(["despesa", "receita"])
      .describe("'despesa' se é um pagamento/saída de dinheiro da empresa, 'receita' se é um recebimento/entrada"),
    valor: z.number().describe("Valor do documento em reais, só o número"),
    data: z.string().describe("Data do documento/pagamento, formato YYYY-MM-DD"),
    categoria: z
      .string()
      .describe(
        `Categoria mais adequada, priorizando reaproveitar uma destas opções (já usadas antes): ${opcoesCategoria.join(", ")}. Só use "Outros" se nada da lista fizer sentido.`
      ),
    descricao: z
      .string()
      .describe(
        "Resumo curto e específico (1 frase) do que foi essa compra/recebimento — ex: 'Compra de 3 rolos de filamento PLA branco', não só 'pagamento'"
      ),
    fornecedor: z.string().nullable().describe("Nome de quem emitiu ou recebeu, ou null se não identificar"),
    formaPagamento: z
      .string()
      .nullable()
      .describe(
        "Forma de pagamento identificada no documento: PIX, Boleto, Cartão de crédito, Cartão de débito, Transferência (TED/DOC), Dinheiro ou Outro. Null se não identificar."
      ),
  });
}

export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Envie um arquivo (multipart/form-data)." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie um arquivo no campo 'file'." }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  const ehImagem = mime.startsWith("image/");
  const ehPdf = mime === "application/pdf";
  if (!ehImagem && !ehPdf) {
    return NextResponse.json(
      { error: "Só aceito PDF, PNG ou JPG por enquanto." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mime};base64,${base64}`;
  const hojeSP = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Ainda não sabemos se o documento é despesa ou receita (a IA decide
  // isso na própria extração), então oferecemos a união das categorias
  // dos dois tipos (fixas + históricas de cada um).
  const [historicasDespesa, historicasReceita] = await Promise.all([
    categoriasHistoricas("despesa"),
    categoriasHistoricas("receita"),
  ]);
  const candidatas = [
    ...mesclarCategorias(CATEGORIAS_DESPESA, historicasDespesa),
    ...mesclarCategorias(CATEGORIAS_RECEITA, historicasReceita),
  ];
  const vistas = new Set<string>();
  const opcoesCategoria = candidatas.filter((c) => {
    const chave = c.toLowerCase();
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });

  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: construirSchemaExtracao(opcoesCategoria),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Você é o assistente financeiro de uma pequena empresa de impressão 3D e marketplace (Shopee/Mercado Livre/TikTok Shop). " +
                "Leia esse comprovante (pode ser boleto, nota fiscal, recibo, comprovante de PIX/transferência, ou print de pagamento) " +
                `e extraia os dados pro controle financeiro. Se não achar uma data no documento, use ${hojeSP}. ` +
                "Se não conseguir ler o valor com confiança, estime 0. " +
                "Preste atenção especial em separar corretamente a categoria (tipo de gasto/receita) da forma de pagamento (PIX, boleto, cartão etc. — geralmente aparece como 'tipo de transferência', 'meio de pagamento' ou no cabeçalho do documento).",
            },
            ehPdf
              ? { type: "file", data: dataUrl, mediaType: mime, filename: file.name }
              : { type: "image", image: dataUrl, mediaType: mime },
          ],
        },
      ],
    });

    return NextResponse.json({
      extraido: object,
      arquivoNome: file.name,
      arquivoMime: mime,
      arquivoBase64: base64,
    });
  } catch (err) {
    console.error("Erro ao ler documento com IA:", err);
    return NextResponse.json(
      {
        error: "Não deu pra ler o documento automaticamente. Preencha os dados manualmente.",
        arquivoNome: file.name,
        arquivoMime: mime,
        arquivoBase64: base64,
      },
      { status: 502 }
    );
  }
}
