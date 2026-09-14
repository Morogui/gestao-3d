import { sql } from "./db";

export interface ClientFullEnvio {
  id: number;
  sku: string;
  nomeProduto: string;
  quantidade: number;
  dataPlanejada: string | null;
  status: string;
  criadoEm: string;
}

async function garantirTabela() {
  await sql`
  CREATE TABLE IF NOT EXISTS client_full_envios (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  nome_produto TEXT NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0,
  data_planejada DATE,
  status TEXT NOT NULL DEFAULT 'planejado',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )
  `;
}

export async function listarEnviosCliente(clientId: string): Promise<ClientFullEnvio[]> {
  await garantirTabela();
  const rows = (await sql`
  SELECT id, sku, nome_produto, quantidade, data_planejada::text AS data_planejada, status, criado_em::text AS criado_em
  FROM client_full_envios
  WHERE client_id = ${clientId}
  ORDER BY criado_em DESC
  `) as any[];

return rows.map((r) => ({
  id: r.id,
  sku: r.sku,
  nomeProduto: r.nome_produto,
  quantidade: r.quantidade,
  dataPlanejada: r.data_planejada,
  status: r.status,
  criadoEm: r.criado_em,
}));
}

export async function criarEnvioCliente(clientId: string, sku: string, nomeProduto: string, quantidade: number, dataPlanejada: string | null): Promise<ClientFullEnvio> {
  await garantirTabela();
  const rows = (await sql`
  INSERT INTO client_full_envios (client_id, sku, nome_produto, quantidade, data_planejada)
  VALUES (${clientId}, ${sku}, ${nomeProduto}, ${quantidade}, ${dataPlanejada})
  RETURNING id, sku, nome_produto, quantidade, data_planejada::text AS data_planejada, status, criado_em::text AS criado_em
  `) as any[];

const r = rows[0];
  return {
    id: r.id,
    sku: r.sku,
    nomeProduto: r.nome_produto,
    quantidade: r.quantidade,
    dataPlanejada: r.data_planejada,
    status: r.status,
    criadoEm: r.criado_em,
  };
}

export async function atualizarEnvioCliente(clientId: string, id: number, sku: string, nomeProduto: string, quantidade: number, dataPlanejada: string | null, status: string): Promise<boolean> {
  await garantirTabela();
  const rows = (await sql`
  UPDATE client_full_envios
  SET sku = ${sku}, nome_produto = ${nomeProduto}, quantidade = ${quantidade}, data_planejada = ${dataPlanejada}, status = ${status}, atualizado_em = now()
  WHERE id = ${id} AND client_id = ${clientId}
  RETURNING id
  `) as any[];

return rows.length > 0;
}

export async function excluirEnvioCliente(clientId: string, id: number): Promise<boolean> {
  await garantirTabela();
  const rows = (await sql`
  DELETE FROM client_full_envios
  WHERE id = ${id} AND client_id = ${clientId}
  RETURNING id
  `) as any[];

return rows.length > 0;
}
