import { NextRequest, NextResponse } from "next/server";
import { criarCliente, listarClientes } from "@/lib/clients";

export const runtime = "nodejs";

// Painel master de clientes (/admin/clientes) -- pedido do Guilherme em
// 2026-09-14: "seria interessante eu conseguir administrar as contas que
// eu for colocando no sistema, e la eu conseguir liberar o que o cliente
// vai ter". Antes disso, criar um cliente novo (ex: Plez Store) exigia
// uma rota de admin one-off escrita a mao (ver
// app/api/admin/criar-cliente-plez/route.ts) -- funcionava mas nao
// escalava pro segundo, terceiro cliente. Esta rota (GET/POST) e a
// generica, reaproveitando lib/clients.ts (criarCliente/listarClientes
// ja existiam, criados junto com o cliente Plez).
//
// So acessivel por quem tem g3d_session (Morolar) -- o middleware.ts
// checa isso no bloco generico do fim do arquivo, ja que /api/admin/*
// nao esta em PUBLIC_API_PATHS nem bate em nenhuma das rotas especiais
// de cliente (nao comeca com /api/c/, nao e /api/mercadolivre/authorize
// com ?cliente=). Um cliente externo logado (client_session) NUNCA
// valida como sessao valida aqui, entao nunca chega nem no handler.

const ABAS_DISPONIVEIS = ["vendas", "full"];

export async function GET() {
  const clientes = await listarClientes();
  return NextResponse.json({ clientes });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, nome, login, senha, abasPermitidas } = body as {
    id?: string;
    nome?: string;
    login?: string;
    senha?: string;
    abasPermitidas?: string[];
  };

  if (!id || !nome || !login || !senha) {
    return NextResponse.json({ error: "Preencha slug, nome, usuario e senha" }, { status: 400 });
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json(
      { error: "Slug deve conter so letras minusculas, numeros e hifen" },
      { status: 400 }
    );
  }
  const abas = Array.isArray(abasPermitidas)
    ? abasPermitidas.filter((a) => ABAS_DISPONIVEIS.includes(a))
    : [];

  await criarCliente({ id, nome, login, senha, abasPermitidas: abas });
  return NextResponse.json({ ok: true });
}
