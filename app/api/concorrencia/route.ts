import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Painel de Concorrencia (aba Analise) - pedido do Guilherme em 2026-08-17:
// comparar cada produto do Full com o concorrente direto mais relevante
// achado no Mercado Livre (preco, fotos, video, vendas, descricao), com
// atualizacao automatica via cron (ver /api/concorrencia/atualizar).
async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS concorrencia (
      id SERIAL PRIMARY KEY,
      produto_chave TEXT UNIQUE NOT NULL,
      produto_nome TEXT NOT NULL,
      nosso_titulo TEXT,
      nosso_mlb_id TEXT,
      nosso_preco NUMERIC,
      nosso_fotos INTEGER,
      nosso_vendidos_label TEXT,
      nosso_vendidos_num INTEGER,
      nosso_desc_chars INTEGER,
      nosso_video BOOLEAN DEFAULT FALSE,
      concorrente_titulo TEXT,
      concorrente_url TEXT,
      concorrente_preco NUMERIC,
      concorrente_fotos INTEGER,
      concorrente_vendidos_label TEXT,
      concorrente_vendidos_num INTEGER,
      concorrente_desc_chars INTEGER,
      risco TEXT,
      observacao TEXT,
      atualizado_em TIMESTAMPTZ DEFAULT now(),
      criado_em TIMESTAMPTZ DEFAULT now()
    )
  `;
}

export async function GET() {
  await garantirTabela();
  const linhas = await sql`
    SELECT * FROM concorrencia ORDER BY produto_nome ASC
  `;
  return NextResponse.json(
    linhas.map((l: any) => ({
      id: l.id,
      produtoChave: l.produto_chave,
      produtoNome: l.produto_nome,
      nossoTitulo: l.nosso_titulo,
      nossoMlbId: l.nosso_mlb_id,
      nossoPreco: l.nosso_preco !== null ? Number(l.nosso_preco) : null,
      nossoFotos: l.nosso_fotos,
      nossoVendidosLabel: l.nosso_vendidos_label,
      nossoVendidosNum: l.nosso_vendidos_num,
      nossoDescChars: l.nosso_desc_chars,
      nossoVideo: l.nosso_video,
      concorrenteTitulo: l.concorrente_titulo,
      concorrenteUrl: l.concorrente_url,
      concorrentePreco: l.concorrente_preco !== null ? Number(l.concorrente_preco) : null,
      concorrenteFotos: l.concorrente_fotos,
      concorrenteVendidosLabel: l.concorrente_vendidos_label,
      concorrenteVendidosNum: l.concorrente_vendidos_num,
      concorrenteDescChars: l.concorrente_desc_chars,
      risco: l.risco,
      observacao: l.observacao,
      atualizadoEm: l.atualizado_em,
      criadoEm: l.criado_em,
    }))
  );
}

export async function POST(req: NextRequest) {
  await garantirTabela();
  const body = await req.json();
  const produtoChave = String(body.produtoChave || "").trim();
  if (!produtoChave) {
    return NextResponse.json({ error: "Informe produtoChave." }, { status: 400 });
  }

  const produtoNome = body.produtoNome ?? null;
  const nossoTitulo = body.nossoTitulo ?? null;
  const nossoMlbId = body.nossoMlbId ?? null;
  const nossoPreco = body.nossoPreco ?? null;
  const nossoFotos = body.nossoFotos ?? null;
  const nossoVendidosLabel = body.nossoVendidosLabel ?? null;
  const nossoVendidosNum = body.nossoVendidosNum ?? null;
  const nossoDescChars = body.nossoDescChars ?? null;
  const nossoVideo = body.nossoVideo ?? false;
  const concorrenteTitulo = body.concorrenteTitulo ?? null;
  const concorrenteUrl = body.concorrenteUrl ?? null;
  const concorrentePreco = body.concorrentePreco ?? null;
  const concorrenteFotos = body.concorrenteFotos ?? null;
  const concorrenteVendidosLabel = body.concorrenteVendidosLabel ?? null;
  const concorrenteVendidosNum = body.concorrenteVendidosNum ?? null;
  const concorrenteDescChars = body.concorrenteDescChars ?? null;
  const risco = body.risco ?? null;
  const observacao = body.observacao ?? null;

  await sql`
    INSERT INTO concorrencia (
      produto_chave, produto_nome, nosso_titulo, nosso_mlb_id, nosso_preco,
      nosso_fotos, nosso_vendidos_label, nosso_vendidos_num, nosso_desc_chars, nosso_video,
      concorrente_titulo, concorrente_url, concorrente_preco, concorrente_fotos,
      concorrente_vendidos_label, concorrente_vendidos_num, concorrente_desc_chars,
      risco, observacao, atualizado_em
    ) VALUES (
      ${produtoChave}, ${produtoNome}, ${nossoTitulo}, ${nossoMlbId}, ${nossoPreco},
      ${nossoFotos}, ${nossoVendidosLabel}, ${nossoVendidosNum}, ${nossoDescChars}, ${nossoVideo},
      ${concorrenteTitulo}, ${concorrenteUrl}, ${concorrentePreco}, ${concorrenteFotos},
      ${concorrenteVendidosLabel}, ${concorrenteVendidosNum}, ${concorrenteDescChars},
      ${risco}, ${observacao}, now()
    )
    ON CONFLICT (produto_chave) DO UPDATE SET
      produto_nome = COALESCE(EXCLUDED.produto_nome, concorrencia.produto_nome),
      nosso_titulo = COALESCE(EXCLUDED.nosso_titulo, concorrencia.nosso_titulo),
      nosso_mlb_id = COALESCE(EXCLUDED.nosso_mlb_id, concorrencia.nosso_mlb_id),
      nosso_preco = COALESCE(EXCLUDED.nosso_preco, concorrencia.nosso_preco),
      nosso_fotos = COALESCE(EXCLUDED.nosso_fotos, concorrencia.nosso_fotos),
      nosso_vendidos_label = COALESCE(EXCLUDED.nosso_vendidos_label, concorrencia.nosso_vendidos_label),
      nosso_vendidos_num = COALESCE(EXCLUDED.nosso_vendidos_num, concorrencia.nosso_vendidos_num),
      nosso_desc_chars = COALESCE(EXCLUDED.nosso_desc_chars, concorrencia.nosso_desc_chars),
      nosso_video = COALESCE(EXCLUDED.nosso_video, concorrencia.nosso_video),
      concorrente_titulo = COALESCE(EXCLUDED.concorrente_titulo, concorrencia.concorrente_titulo),
      concorrente_url = COALESCE(EXCLUDED.concorrente_url, concorrencia.concorrente_url),
      concorrente_preco = COALESCE(EXCLUDED.concorrente_preco, concorrencia.concorrente_preco),
      concorrente_fotos = COALESCE(EXCLUDED.concorrente_fotos, concorrencia.concorrente_fotos),
      concorrente_vendidos_label = COALESCE(EXCLUDED.concorrente_vendidos_label, concorrencia.concorrente_vendidos_label),
      concorrente_vendidos_num = COALESCE(EXCLUDED.concorrente_vendidos_num, concorrencia.concorrente_vendidos_num),
      concorrente_desc_chars = COALESCE(EXCLUDED.concorrente_desc_chars, concorrencia.concorrente_desc_chars),
      risco = COALESCE(EXCLUDED.risco, concorrencia.risco),
      observacao = COALESCE(EXCLUDED.observacao, concorrencia.observacao),
      atualizado_em = now()
  `;

  return NextResponse.json({ ok: true });
}
