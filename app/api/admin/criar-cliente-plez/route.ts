import { NextResponse } from "next/server";
import { criarCliente } from "@/lib/clients";

// Rota one-time protegida pela sessao Morolar (nao esta em
// PUBLIC_API_PATHS do middleware.ts) pra criar o primeiro cliente
// externo do Escala 7x7. Pedido do Guilherme em 2026-09-14: testar o
// sistema multi-tenant com a Plez Store, login "Plez" / senha
// "Senh12Plz!", so com as abas Vendas e Full.
export async function POST() {
  await criarCliente({
    id: "plez",
    nome: "Plez Store",
    login: "Plez",
    senha: "Senh12Plz!",
    abasPermitidas: ["vendas", "full"],
  });
  return NextResponse.json({ ok: true });
}
