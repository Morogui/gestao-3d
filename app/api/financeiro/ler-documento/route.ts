import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";

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
const schemaExtracao = z.object({
  tipo: z
    .enum(["despesa", "receita"])
    .describe("'despesa' se é um pagamento/saída de dinheiro da empresa, 'receita' se é um recebimento/entrada"),
  valor: z.number().describe("Valor do documento em reais, só o número"),
  data: z.string().describe("Data do documento/pagamento, formato YYYY-MM-DD"),
  categoria: z
    .string()
    .describe(
      "Categoria curta: Filamento, Energia elétrica, Embalagem, Frete, Marketing/Ads, Taxas de marketplace, Impostos, Manutenção de equipamento, Software/Assinaturas, Aluguel, Internet/Telefone, Salário/Pró-labore, Venda direta, Reembolso ou Outros"
    ),
  descricao: z.string().describe("Resumo curto (1 frase) do que é o documento"),
  fornecedor: z.string().nullable().describe("Nome de quem emitiu ou recebeu, ou null se não identificar"),
});

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

  try {
    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: schemaExtracao,
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
                "Se não conseguir ler o valor com confiança, estime 0.",
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
