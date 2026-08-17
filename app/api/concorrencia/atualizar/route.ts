import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Atualizacao automatica dos dados de concorrencia (cron diario, ver vercel.json).
// Reabre cada concorrente_url ja salvo, extrai preco/fotos/descricao/vendidos
// da propria pagina publica e atualiza a linha correspondente em "concorrencia".
// Chamado tanto pelo cron quanto manualmente (POST) pela tela de Analise.

type DadosExtraidos = {
  preco: number | null;
  fotos: number | null;
  descChars: number | null;
  vendidosLabel: string | null;
  vendidosNum: number | null;
};

function extrairDoHtml(html: string): DadosExtraidos {
  let preco: number | null = null;
  let fotos: number | null = null;
  let descChars: number | null = null;
  let vendidosLabel: string | null = null;
  let vendidosNum: number | null = null;

  // JSON-LD (schema.org Product) costuma trazer image[], description e offers.price
  const blocos = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const bloco of blocos) {
    const jsonTexto = bloco
      .replace(/<script type="application\/ld\+json">/, "")
      .replace(/<\/script>/, "");
    try {
      const dados = JSON.parse(jsonTexto);
      const tipo = dados["@type"];
      const ehProduto = tipo === "Product" || (Array.isArray(tipo) && tipo.includes("Product"));
      if (ehProduto) {
        if (Array.isArray(dados.image)) fotos = dados.image.length;
        else if (typeof dados.image === "string") fotos = 1;
        if (typeof dados.description === "string") descChars = dados.description.length;
        const oferta = Array.isArray(dados.offers) ? dados.offers[0] : dados.offers;
        if (oferta && oferta.price) preco = Number(oferta.price);
      }
    } catch {
      // ld+json malformado nessa pagina - ignora e segue com os outros sinais
    }
  }

  // Fallback: meta itemprop=price, quando o JSON-LD nao trouxe preco
  if (preco === null) {
    const metaPreco = html.match(/itemprop="price"\s+content="([\d.]+)"/);
    if (metaPreco) preco = Number(metaPreco[1]);
  }

  // "vendidos" nao vem no schema.org - procura no texto visivel da pagina
  const textoSemTags = html.replace(/<[^>]+>/g, " ");
  const vendidosMatch = textoSemTags.match(/\+?\d[\d.,]*\s*vendidos?/i);
  if (vendidosMatch) {
    vendidosLabel = vendidosMatch[0].trim();
    const numeroLimpo = vendidosLabel.replace(/\D/g, "");
    vendidosNum = numeroLimpo ? Number(numeroLimpo) : null;
  }

  return { preco, fotos, descChars, vendidosLabel, vendidosNum };
}

async function executarAtualizacao() {
  const linhas = await sql`
    SELECT id, concorrente_url FROM concorrencia WHERE concorrente_url IS NOT NULL
  `;

  const resultados: any[] = [];
  for (const linha of linhas) {
    try {
      const res = await fetch(linha.concorrente_url as string, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
      });
      if (!res.ok) {
        resultados.push({ id: linha.id, ok: false, status: res.status });
        continue;
      }
      const html = await res.text();
      const dados = extrairDoHtml(html);
      await sql`
        UPDATE concorrencia SET
          concorrente_preco = COALESCE(${dados.preco}, concorrente_preco),
          concorrente_fotos = COALESCE(${dados.fotos}, concorrente_fotos),
          concorrente_desc_chars = COALESCE(${dados.descChars}, concorrente_desc_chars),
          concorrente_vendidos_label = COALESCE(${dados.vendidosLabel}, concorrente_vendidos_label),
          concorrente_vendidos_num = COALESCE(${dados.vendidosNum}, concorrente_vendidos_num),
          atualizado_em = now()
        WHERE id = ${linha.id}
      `;
      resultados.push({ id: linha.id, ok: true, ...dados });
    } catch (erro: any) {
      resultados.push({ id: linha.id, ok: false, erro: erro?.message || String(erro) });
    }
  }

  return { atualizadoEm: new Date().toISOString(), total: linhas.length, resultados };
}

export async function GET() {
  const resultado = await executarAtualizacao();
  return NextResponse.json(resultado);
}

export async function POST() {
  const resultado = await executarAtualizacao();
  return NextResponse.json(resultado);
}
