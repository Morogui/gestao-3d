import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { sql } from "@/lib/db";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA } from "@/lib/financeiro";
import { categoriasHistoricas, mesclarCategorias } from "@/lib/financeiro-categorias";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bot do Telegram (@morolar_comprovantes_bot) — pedido do Guilherme em
// 2026-08-12: "Teria como lincar a parte financeira para enviar o
// comprovante por whatsapp ou telegram?" -> escolheu Telegram, só
// ENTRADA (ele manda foto/PDF pro bot, a IA extrai e já lança direto no
// Financeiro — sem passo de confirmação, mesmo espírito "atalho" que o
// pedido de filamento em app/estoque/page.tsx já usa pro Financeiro).
// Token do bot, o chat ID autorizado (só o dele) e o segredo do webhook
// vivem em variáveis de ambiente (TELEGRAM_BOT_TOKEN,
// TELEGRAM_ALLOWED_CHAT_ID, TELEGRAM_WEBHOOK_SECRET) — nunca no código.
//
// Assume que todo comprovante mandado já é um PAGAMENTO CONCLUÍDO (nasce
// status "pago", data de pagamento = data extraída do documento) — é o
// caso de uso normal de "comprovante" (recibo/nota depois de pagar).
// Se for um boleto ainda pendente, o Guilherme ajusta manualmente depois
// na aba Financeiro.

function schemaExtracao(opcoesCategoria: string[]) {
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

async function enviarMensagem(token: string, chatId: number | string, texto: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
    });
  } catch {
    // silencioso — não derruba o webhook por causa de um envio de resposta
  }
}

export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIdPermitido = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const secretEsperado = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Sem token/chat configurado ainda — responde OK sem fazer nada (evita
  // erro 500 no Telegram enquanto a integração está sendo montada).
  if (!token || !chatIdPermitido) {
    return NextResponse.json({ ok: true });
  }

  if (secretEsperado) {
    const secretRecebido = request.headers.get("x-telegram-bot-api-secret-token");
    if (secretRecebido !== secretEsperado) {
      return NextResponse.json({ ok: true });
    }
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = (update as { message?: Record<string, unknown> } | null)?.message;
  const chat = message?.chat as { id?: number } | undefined;
  const chatId = chat?.id;
  if (!message || chatId === undefined) {
    return NextResponse.json({ ok: true });
  }

  // Bot é de uso pessoal do Guilherme — ignora silenciosamente qualquer
  // outro chat (evita alguém achando o bot e mandando lançamento falso).
  if (String(chatId) !== String(chatIdPermitido)) {
    return NextResponse.json({ ok: true });
  }

  // Descobre o arquivo (foto comprimida do Telegram ou documento PDF/imagem)
  let fileId: string | null = null;
  let mimeSugerido = "image/jpeg";
  const photos = message.photo as { file_id: string }[] | undefined;
  const documento = message.document as { file_id: string; mime_type?: string } | undefined;
  if (Array.isArray(photos) && photos.length > 0) {
    fileId = photos[photos.length - 1].file_id; // maior resolução disponível
    mimeSugerido = "image/jpeg";
  } else if (documento) {
    const mime = documento.mime_type || "";
    if (mime.startsWith("image/") || mime === "application/pdf") {
      fileId = documento.file_id;
      mimeSugerido = mime;
    }
  }

  if (!fileId) {
    await enviarMensagem(
      token,
      chatId,
      "Manda uma foto ou PDF do comprovante que eu leio e já lanço no Financeiro. 📎"
    );
    return NextResponse.json({ ok: true });
  }

  try {
    const fileInfoRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileInfo = (await fileInfoRes.json()) as { result?: { file_path?: string } };
    const filePath = fileInfo.result?.file_path;
    if (!filePath) throw new Error("Telegram não devolveu file_path");

    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mime = filePath.toLowerCase().endsWith(".pdf") ? "application/pdf" : mimeSugerido;
    const dataUrl = `data:${mime};base64,${base64}`;
    const nomeArquivo = filePath.split("/").pop() || "comprovante";

    const hojeSP = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

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

    const { object } = await generateObject({
      model: "anthropic/claude-sonnet-5",
      schema: schemaExtracao(opcoesCategoria),
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
            mime === "application/pdf"
              ? { type: "file", data: dataUrl, mediaType: mime, filename: nomeArquivo }
              : { type: "image", image: dataUrl, mediaType: mime },
          ],
        },
      ],
    });

    if (!object.valor || object.valor <= 0) {
      await enviarMensagem(
        token,
        chatId,
        "Não consegui ler o valor desse comprovante com confiança. Lança manualmente no site (aba Financeiro) ou manda uma foto mais nítida."
      );
      return NextResponse.json({ ok: true });
    }

    const dataDocumento = object.data || hojeSP;

    const rows = (await sql`
      INSERT INTO financeiro_lancamentos
        (tipo, categoria, descricao, valor, data_vencimento, data_pagamento, status, fornecedor, forma_pagamento, arquivo_nome, arquivo_mime, arquivo_base64)
      VALUES
        (${object.tipo}, ${object.categoria}, ${object.descricao}, ${object.valor}, ${dataDocumento}, ${dataDocumento}, 'pago', ${object.fornecedor}, ${object.formaPagamento}, ${nomeArquivo}, ${mime}, ${base64})
      RETURNING id
    `) as { id: number }[];
    const id = rows[0]?.id;

    const valorFormatado = object.valor.toFixed(2).replace(".", ",");
    const resumo =
      `✅ Lançamento #${id} criado no Financeiro\n` +
      `${object.tipo === "despesa" ? "Despesa" : "Receita"} · ${object.categoria}\n` +
      `R$ ${valorFormatado} · ${dataDocumento}\n` +
      (object.fornecedor ? `Fornecedor: ${object.fornecedor}\n` : "") +
      (object.formaPagamento ? `Pagamento: ${object.formaPagamento}\n` : "") +
      object.descricao;
    await enviarMensagem(token, chatId, resumo);
  } catch (err) {
    console.error("Erro no webhook do Telegram:", err);
    await enviarMensagem(
      token,
      chatId,
      "Não consegui ler esse comprovante automaticamente. Tenta mandar de novo ou lança manualmente no site."
    );
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, info: "Webhook do bot Morolar Comprovantes." });
}
