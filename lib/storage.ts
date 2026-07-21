"use client";

// Persistência simples em localStorage.
// Observação: isso funciona bem para uso individual agora (aba Custo).
// Quando as abas Vendas/Produção entrarem (integrações de API rodando
// no servidor), o cadastro de produtos deve migrar para um banco de
// dados compartilhado (ex: Postgres via Vercel/Neon) em vez de
// localStorage, que só existe no navegador de quem acessa.

import { DEFAULT_PARAMS, GlobalParams, ProdutoInput } from "./custo";

const PARAMS_KEY = "gestao3d:params";
const PRODUTOS_KEY = "gestao3d:produtos";

export function loadParams(): GlobalParams {
  if (typeof window === "undefined") return DEFAULT_PARAMS;
  try {
    const raw = window.localStorage.getItem(PARAMS_KEY);
    if (!raw) return DEFAULT_PARAMS;
    return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PARAMS;
  }
}

export function saveParams(params: GlobalParams): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
}

export function loadProdutos(): ProdutoInput[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRODUTOS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveProdutos(produtos: ProdutoInput[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRODUTOS_KEY, JSON.stringify(produtos));
}
