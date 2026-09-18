// Catálogo de caixas de envio (tamanho + preço + fornecedor) usadas
// pra calcular o custo real de embalagem por SKU -- pedido do
// Guilherme em 18/09/2026: antes o custo de embalagem era só um valor
// fixo (embalagemPadrao em app/api/precificacao/produtos/route.ts,
// R$1,10 padrão ou R$1,95 pra alguns produtos maiores tipo STAM-01/02
// e Suporte Coração). Agora existe um catálogo real de caixas
// (dimensões + preço + fornecedor, hoje só a Thebox) e cada SKU
// escolhe qual caixa usa -- ver caixa_envio_id em
// precificacao_produtos / precificacao_sku_virtual
// (app/api/precificacao/produtos/route.ts). Quando um SKU tem caixa
// selecionada, o preço da caixa vira o custo de embalagem (substitui
// o valor manual/padrão), e o peso da caixa (quando preenchido) soma
// no peso de envio -- por enquanto peso_caixa_g fica em branco pros 3
// tamanhos cadastrados (o Guilherme não pesou as caixas vazias ainda),
// editável depois via UPDATE direto ou numa tela futura.
//
// Fornecedor fica armazenado na própria caixa (uma vez por tamanho),
// não por SKU -- o que cada SKU escolhe é só o tamanho da caixa.

import { sql } from "@/lib/db";

export async function ensureCaixasTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS caixas_envio (
      id SERIAL PRIMARY KEY,
      nome TEXT UNIQUE NOT NULL,
      comprimento_cm NUMERIC,
      largura_cm NUMERIC,
      altura_cm NUMERIC,
      preco NUMERIC NOT NULL DEFAULT 0,
      peso_caixa_g NUMERIC,
      fornecedor TEXT,
      ativa BOOLEAN NOT NULL DEFAULT true,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Seed inicial -- 3 tamanhos usados hoje, fornecedor Thebox pros
  // três. ON CONFLICT (nome) DO NOTHING garante que isso só cria uma
  // vez; preço/dimensões ficam livres pra editar depois sem serem
  // resetados a cada deploy.
  await sql`
    INSERT INTO caixas_envio (nome, comprimento_cm, largura_cm, altura_cm, preco, fornecedor)
    VALUES
      ('Caixa Pequena', 16, 11, 6, 0.68, 'Thebox'),
      ('Caixa Média', 18, 13, 9, 0.95, 'Thebox'),
      ('Caixa Grande', 30, 20, 11, 1.99, 'Thebox')
    ON CONFLICT (nome) DO NOTHING
  `;
}

export interface CaixaEnvioRow {
  id: number;
  nome: string;
  comprimento_cm: string | null;
  largura_cm: string | null;
  altura_cm: string | null;
  preco: string;
  peso_caixa_g: string | null;
  fornecedor: string | null;
  ativa: boolean;
}

export interface CaixaEnvio {
  id: number;
  nome: string;
  comprimentoCm: number | null;
  larguraCm: number | null;
  alturaCm: number | null;
  preco: number;
  pesoCaixaG: number | null;
  fornecedor: string | null;
  ativa: boolean;
}

export function mapCaixaRow(r: CaixaEnvioRow): CaixaEnvio {
  return {
    id: r.id,
    nome: r.nome,
    comprimentoCm: r.comprimento_cm != null ? Number(r.comprimento_cm) : null,
    larguraCm: r.largura_cm != null ? Number(r.largura_cm) : null,
    alturaCm: r.altura_cm != null ? Number(r.altura_cm) : null,
    preco: Number(r.preco),
    pesoCaixaG: r.peso_caixa_g != null ? Number(r.peso_caixa_g) : null,
    fornecedor: r.fornecedor,
    ativa: r.ativa,
  };
}

export async function listarCaixas(): Promise<CaixaEnvio[]> {
  const rows = (await sql`
    SELECT id, nome, comprimento_cm, largura_cm, altura_cm, preco, peso_caixa_g, fornecedor, ativa
    FROM caixas_envio
    ORDER BY preco ASC
  `) as CaixaEnvioRow[];
  return rows.map(mapCaixaRow);
}
