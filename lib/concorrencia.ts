import { sql } from "@/lib/db";

// Dados de concorrencia mostrados na aba Analise (secao "Concorrencia").
// A tabela concorrencia e alimentada manualmente (levantamento inicial) e
// depois mantida em dia sozinha pelo cron /api/concorrencia/atualizar.

export type LinhaConcorrencia = {
  id: number;
  produtoChave: string;
  produtoNome: string;
  nossoTitulo: string | null;
  nossoMlbId: string | null;
  nossoPreco: number | null;
  nossoFotos: number | null;
  nossoVendidosLabel: string | null;
  nossoVendidosNum: number | null;
  nossoDescChars: number | null;
  nossoVideo: boolean;
  concorrenteTitulo: string | null;
  concorrenteUrl: string | null;
  concorrentePreco: number | null;
  concorrenteFotos: number | null;
  concorrenteVendidosLabel: string | null;
  concorrenteVendidosNum: number | null;
  concorrenteDescChars: number | null;
  risco: string | null;
  observacao: string | null;
  atualizadoEm: string;
};

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

export async function getConcorrencia(): Promise<LinhaConcorrencia[]> {
  try {
    await garantirTabela();
    const linhas = await sql`SELECT * FROM concorrencia ORDER BY produto_nome ASC`;
    return linhas.map((l: any) => ({
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
      nossoVideo: Boolean(l.nosso_video),
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
    }));
  } catch {
    // Tabela ainda nao existe ou banco indisponivel - secao mostra vazio em vez de derrubar a pagina
    return [];
  }
}
