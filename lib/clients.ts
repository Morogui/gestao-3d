import crypto from "crypto";
import { sql } from "./db";

// Tabela multi-tenant: cada linha e um cliente do Escala 7x7 (ex: "plez")
// que acessa uma versao enxuta do gestao-3d em /<slug>, com login
// proprio e so as abas liberadas em abas_permitidas. A Morolar continua
// usando o login antigo (env vars + g3d_session) sem nenhuma mudanca --
// esta tabela e tudo que depende dela e aditivo, criado pra suportar o
// primeiro cliente externo (Plez Store) pedido pelo Guilherme em
// 2026-09-14: "chegou a hora de testar com um cliente meu".
export interface Cliente {
  id: string;
  nome: string;
  login: string;
  abasPermitidas: string[];
}

interface ClienteRow {
  id: string;
  nome: string;
  login: string;
  senha_salt: string;
  senha_hash: string;
  abas_permitidas: string[];
}

async function garantirTabela() {
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      login TEXT NOT NULL,
      senha_salt TEXT NOT NULL,
      senha_hash TEXT NOT NULL,
      abas_permitidas TEXT[] NOT NULL DEFAULT '{}',
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

function hashSenha(senha: string, salt: string): string {
  return crypto.scryptSync(senha, salt, 64).toString("hex");
}

// Cria ou atualiza um cliente (idempotente via ON CONFLICT) -- usado
// pelas rotas de admin em app/api/admin/*.
export async function criarCliente(params: {
  id: string;
  nome: string;
  login: string;
  senha: string;
  abasPermitidas: string[];
}): Promise<void> {
  await garantirTabela();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashSenha(params.senha, salt);
  await sql`
    INSERT INTO clients (id, nome, login, senha_salt, senha_hash, abas_permitidas)
    VALUES (${params.id}, ${params.nome}, ${params.login}, ${salt}, ${hash}, ${params.abasPermitidas})
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome,
      login = EXCLUDED.login,
      senha_salt = EXCLUDED.senha_salt,
      senha_hash = EXCLUDED.senha_hash,
      abas_permitidas = EXCLUDED.abas_permitidas
  `;
}

function rowToCliente(row: ClienteRow): Cliente {
  return {
    id: row.id,
    nome: row.nome,
    login: row.login,
    abasPermitidas: row.abas_permitidas ?? [],
  };
}

export async function getCliente(id: string): Promise<Cliente | null> {
  await garantirTabela();
  const rows = (await sql`SELECT * FROM clients WHERE id = ${id}`) as ClienteRow[];
  if (rows.length === 0) return null;
  return rowToCliente(rows[0]);
}

// Lista todos os clientes cadastrados, mais recentes primeiro -- usado
// pelo painel master (/admin/clientes, pedido do Guilherme em
// 2026-09-14: "conseguir administrar as contas que eu for colocando no
// sistema").
export async function listarClientes(): Promise<Cliente[]> {
  await garantirTabela();
  const rows = (await sql`SELECT * FROM clients ORDER BY criado_em DESC`) as ClienteRow[];
  return rows.map(rowToCliente);
}

// Atualiza nome/abas_permitidas de um cliente ja existente (usado pelo
// painel master pra liberar/revogar abas sem precisar redigitar login e
// senha). Nao mexe em login/senha -- isso fica a cargo de
// atualizarSenhaCliente abaixo, chamado separadamente so quando o
// Guilherme realmente quer resetar a senha.
export async function atualizarCliente(
  id: string,
  params: { nome: string; abasPermitidas: string[] }
): Promise<boolean> {
  await garantirTabela();
  const rows = (await sql`
    UPDATE clients
    SET nome = ${params.nome}, abas_permitidas = ${params.abasPermitidas}
    WHERE id = ${id}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

// Reseta a senha de um cliente ja existente (painel master) -- mesmo
// hash com salt novo, igual criarCliente.
export async function atualizarSenhaCliente(id: string, novaSenha: string): Promise<boolean> {
  await garantirTabela();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashSenha(novaSenha, salt);
  const rows = (await sql`
    UPDATE clients
    SET senha_salt = ${salt}, senha_hash = ${hash}
    WHERE id = ${id}
    RETURNING id
  `) as { id: string }[];
  return rows.length > 0;
}

// Verifica usuario/senha pro slug informado. Comparacao de hash com
// timingSafeEqual (mesmo padrao de app/api/auth/login/route.ts) pra
// evitar timing attack. Ainda usada onde o slug ja e conhecido de
// antemao; para o login unificado (usuario nao informa o slug) ver
// verificarLoginGlobal abaixo.
export async function verificarLogin(
  id: string,
  login: string,
  senha: string
): Promise<Cliente | null> {
  await garantirTabela();
  const rows = (await sql`SELECT * FROM clients WHERE id = ${id}`) as ClienteRow[];
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.login !== login) return null;
  const hash = hashSenha(senha, row.senha_salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.senha_hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return rowToCliente(row);
}

// Login unificado (pedido do Guilherme em 2026-09-14: "o login da plez
// ou da morolar, tem que ser feitos por essa janela .../login") -- busca
// por usuario em QUALQUER linha da tabela clients, sem precisar saber o
// slug de antemao (quem loga em /login so digita usuario/senha, nunca
// o slug). app/api/auth/login/route.ts tenta primeiro a conta Morolar
// (env vars) e, se nao bater, cai aqui pra checar se e um cliente
// externo cadastrado.
export async function verificarLoginGlobal(
  login: string,
  senha: string
): Promise<Cliente | null> {
  await garantirTabela();
  const rows = (await sql`SELECT * FROM clients WHERE login = ${login}`) as ClienteRow[];
  if (rows.length === 0) return null;
  const row = rows[0];
  const hash = hashSenha(senha, row.senha_salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(row.senha_hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return rowToCliente(row);
}
