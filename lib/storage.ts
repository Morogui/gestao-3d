"use client";

// Persistência da aba Custo — antes era localStorage do navegador, agora
// é o Postgres (Neon) compartilhado, via rotas de API (/api/produtos e
// /api/parametros). Isso corrige a limitação de antes (dados só
// existiam no navegador de quem cadastrou) e permite que a aba Produção
// cruze os mesmos produtos no servidor.

import { DEFAULT_PARAMS, GlobalParams, ProdutoInput } from "./custo";

export async function loadParams(): Promise<GlobalParams> {
  try {
    const res = await fetch("/api/parametros");
    if (!res.ok) return DEFAULT_PARAMS;
    return await res.json();
  } catch {
    return DEFAULT_PARAMS;
  }
}

export async function saveParams(params: GlobalParams): Promise<GlobalParams> {
  const res = await fetch("/api/parametros", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function loadProdutos(): Promise<ProdutoInput[]> {
  try {
    const res = await fetch("/api/produtos");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function criarProduto(
  produto: Omit<ProdutoInput, "id">
): Promise<ProdutoInput> {
  const res = await fetch("/api/produtos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(produto),
  });
  if (!res.ok) throw new Error("Não foi possível criar o produto");
  return res.json();
}

export async function atualizarProduto(produto: ProdutoInput): Promise<ProdutoInput> {
  const { id, ...rest } = produto;
  const res = await fetch(`/api/produtos/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rest),
  });
  if (!res.ok) throw new Error("Não foi possível salvar o produto");
  return res.json();
}

export async function excluirProduto(id: string): Promise<void> {
  await fetch(`/api/produtos/${id}`, { method: "DELETE" });
}
