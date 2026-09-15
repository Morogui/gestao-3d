import { sql } from "./db";
import { ConfigPrecificacao, DEFAULT_CONFIG_PRECIFICACAO } from "./precificacao";

// Catalogo de produtos (SKU/nome/custo) e configuracao de precificacao
// por cliente externo, escopados por client_id. Replica simplificada
// do par produtos + precificacao_config do Morolar, mas sem as tabelas
// de placas/filamento (especificas de impressao 3D) -- aqui o custo de
// producao e um valor manual direto por SKU. Pedido do Guilherme em
// 2026-09-15: replicar a estrutura de Produtos + Precificacao pro
// cliente Garimpo (loja de roupas).

export interface ClientProduto {
  id: number;
  sku: string;
  nome: string;
  custoProducao: number;
  pesoEnvioKg: number;
  precoVendaML: number | null;
  precoVendaShopee: number | null;
  criadoEm: string;
  atualizadoEm: string;
}

let tabelasGarantidas = false;

async function garantirTabelas() {
  if (tabelasGarantidas) return;
  await sql`
    CREATE TABLE IF NOT EXISTS client_produtos (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      nome TEXT NOT NULL,
      custo_producao NUMERIC NOT NULL DEFAULT 0,
      peso_envio_kg NUMERIC NOT NULL DEFAULT 0,
      preco_venda_ml NUMERIC,
      preco_venda_shopee NUMERIC,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(client_id, sku)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS client_precificacao_config (
      client_id TEXT PRIMARY KEY,
      imposto_pct NUMERIC NOT NULL DEFAULT 6,
      ads_pct_ml NUMERIC NOT NULL DEFAULT 5,
      ads_pct_shopee NUMERIC NOT NULL DEFAULT 10,
      afiliado_pct_shopee NUMERIC NOT NULL DEFAULT 0,
      embalagem_custo NUMERIC NOT NULL DEFAULT 1.1,
      margem_desejada_pct NUMERIC NOT NULL DEFAULT 20,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  tabelasGarantidas = true;
}

function mapProduto(r: any): ClientProduto {
  return {
    id: r.id,
    sku: r.sku,
    nome: r.nome,
    custoProducao: Number(r.custo_producao),
    pesoEnvioKg: Number(r.peso_envio_kg),
    precoVendaML: r.preco_venda_ml === null ? null : Number(r.preco_venda_ml),
    precoVendaShopee: r.preco_venda_shopee === null ? null : Number(r.preco_venda_shopee),
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}

export async function listarProdutosCliente(clientId: string): Promise<ClientProduto[]> {
  await garantirTabelas();
  const rows = (await sql`
    SELECT id, sku, nome, custo_producao, peso_envio_kg, preco_venda_ml, preco_venda_shopee,
           criado_em::text AS criado_em, atualizado_em::text AS atualizado_em
    FROM client_produtos
    WHERE client_id = ${clientId}
    ORDER BY nome ASC
  `) as any[];
  return rows.map(mapProduto);
}

export async function criarProdutoCliente(
  clientId: string,
  dados: { sku: string; nome: string; custoProducao: number; pesoEnvioKg: number }
): Promise<ClientProduto> {
  await garantirTabelas();
  const rows = (await sql`
    INSERT INTO client_produtos (client_id, sku, nome, custo_producao, peso_envio_kg)
    VALUES (${clientId}, ${dados.sku}, ${dados.nome}, ${dados.custoProducao}, ${dados.pesoEnvioKg})
    ON CONFLICT (client_id, sku) DO UPDATE SET
      nome = EXCLUDED.nome,
      custo_producao = EXCLUDED.custo_producao,
      peso_envio_kg = EXCLUDED.peso_envio_kg,
      atualizado_em = now()
    RETURNING id, sku, nome, custo_producao, peso_envio_kg, preco_venda_ml, preco_venda_shopee,
              criado_em::text AS criado_em, atualizado_em::text AS atualizado_em
  `) as any[];
  return mapProduto(rows[0]);
}

export async function atualizarProdutoCliente(
  clientId: string,
  id: number,
  patch: Partial<{
    sku: string;
    nome: string;
    custoProducao: number;
    pesoEnvioKg: number;
    precoVendaML: number | null;
    precoVendaShopee: number | null;
  }>
): Promise<boolean> {
  await garantirTabelas();
  const atual = (await sql`
    SELECT sku, nome, custo_producao, peso_envio_kg, preco_venda_ml, preco_venda_shopee
    FROM client_produtos WHERE id = ${id} AND client_id = ${clientId}
  `) as any[];
  if (atual.length === 0) return false;
  const a = atual[0];

  const sku = patch.sku !== undefined ? patch.sku : a.sku;
  const nome = patch.nome !== undefined ? patch.nome : a.nome;
  const custoProducao = patch.custoProducao !== undefined ? patch.custoProducao : Number(a.custo_producao);
  const pesoEnvioKg = patch.pesoEnvioKg !== undefined ? patch.pesoEnvioKg : Number(a.peso_envio_kg);
  const precoVendaML = patch.precoVendaML !== undefined ? patch.precoVendaML : a.preco_venda_ml;
  const precoVendaShopee = patch.precoVendaShopee !== undefined ? patch.precoVendaShopee : a.preco_venda_shopee;

  const rows = (await sql`
    UPDATE client_produtos
    SET sku = ${sku}, nome = ${nome}, custo_producao = ${custoProducao}, peso_envio_kg = ${pesoEnvioKg},
        preco_venda_ml = ${precoVendaML}, preco_venda_shopee = ${precoVendaShopee}, atualizado_em = now()
    WHERE id = ${id} AND client_id = ${clientId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

export async function excluirProdutoCliente(clientId: string, id: number): Promise<boolean> {
  await garantirTabelas();
  const rows = (await sql`
    DELETE FROM client_produtos WHERE id = ${id} AND client_id = ${clientId}
    RETURNING id
  `) as any[];
  return rows.length > 0;
}

export async function getConfigCliente(clientId: string): Promise<ConfigPrecificacao> {
  await garantirTabelas();
  const rows = (await sql`
    SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct
    FROM client_precificacao_config WHERE client_id = ${clientId}
  `) as any[];
  if (rows.length === 0) return { ...DEFAULT_CONFIG_PRECIFICACAO };
  const r = rows[0];
  return {
    impostoPct: Number(r.imposto_pct),
    adsPctML: Number(r.ads_pct_ml),
    adsPctShopee: Number(r.ads_pct_shopee),
    afiliadoPctShopee: Number(r.afiliado_pct_shopee),
    embalagemCusto: Number(r.embalagem_custo),
    margemDesejadaPct: Number(r.margem_desejada_pct),
  };
}

export async function atualizarConfigCliente(
  clientId: string,
  patch: Partial<ConfigPrecificacao>
): Promise<ConfigPrecificacao> {
  await garantirTabelas();
  const atual = await getConfigCliente(clientId);
  const novo: ConfigPrecificacao = { ...atual, ...patch };
  await sql`
    INSERT INTO client_precificacao_config (client_id, imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, atualizado_em)
    VALUES (${clientId}, ${novo.impostoPct}, ${novo.adsPctML}, ${novo.adsPctShopee}, ${novo.afiliadoPctShopee}, ${novo.embalagemCusto}, ${novo.margemDesejadaPct}, now())
    ON CONFLICT (client_id) DO UPDATE SET
      imposto_pct = EXCLUDED.imposto_pct,
      ads_pct_ml = EXCLUDED.ads_pct_ml,
      ads_pct_shopee = EXCLUDED.ads_pct_shopee,
      afiliado_pct_shopee = EXCLUDED.afiliado_pct_shopee,
      embalagem_custo = EXCLUDED.embalagem_custo,
      margem_desejada_pct = EXCLUDED.margem_desejada_pct,
      atualizado_em = now()
  `;
  return novo;
}
