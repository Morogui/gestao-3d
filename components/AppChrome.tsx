"use client";

import { usePathname } from "next/navigation";
import TabsNav from "@/components/TabsNav";
import MorolarLogoutButton from "@/components/MorolarLogoutButton";

// A "/painel" é a landing page pública do Escala 7x7 Ecommerce (marca de
// serviço do Guilherme) e "/login" é a tela de acesso — nenhuma das duas
// deve mostrar o cabeçalho/menu do sistema interno de gestão da MOROLAR
// (Custo, Vendas, Produção, Estoque, Full, Financeiro, Relatórios, Analise,
// Precificação). Antes esse cabeçalho vinha direto do RootLayout e
// aparecia em cima de TODAS as páginas, inclusive a pública — misturando
// as duas marcas/produtos na mesma tela (bug reportado pelo Guilherme em
// 2026-08-25). Esse componente decide, com base na rota atual, se mostra
// o "chrome" do sistema interno ou renderiza a página sozinha.
const PUBLIC_LAYOUT_PATHS = ["/", "/painel", "/login", "/mercadolivrecalculadora", "/shopeecalculadora"];

function isPublicLayoutPath(pathname: string): boolean {
  return PUBLIC_LAYOUT_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
// Cada cliente (ex: Plez Store) tem sua propria area em "/[slug]/login|vendas|full",
// isolada do sistema interno da Morolar e com seu proprio chrome (ver app/[cliente]/layout.tsx).
// Precisa espelhar a mesma lista de segmentos reservados do middleware.ts (RESERVED_TOP_SEGMENTS)
// pra nao confundir uma rota interna (ex: /vendas) com uma area de cliente (ex: /plez/vendas).
const RESERVED_TOP_SEGMENTS = new Set([
  "api", "login", "painel", "vendas", "full", "produtos", "producao", "custo",
  "estoque", "financeiro", "relatorios", "analise", "precificacao",
  "mercadolivrecalculadora", "shopeecalculadora",
]);
const CLIENTE_SUBPATHS = ["login", "vendas", "full"];

function isClienteAreaPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  const [slug, sub] = parts;
  if (RESERVED_TOP_SEGMENTS.has(slug)) return false;
  return CLIENTE_SUBPATHS.includes(sub);
}
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  if (isPublicLayoutPath(pathname) || isClienteAreaPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Morolar" className="h-10 w-auto" />
          <p className="mt-1 text-sm text-gray-500">
            Custo · Vendas · Produção · Estoque · Full · Financeiro · Relatórios
          </p>
        </div>
        {/* 2026-09-15 -- pedido do Guilherme: faltava um jeito de sair do
            sistema (o login de cliente externo ja tinha, esse chrome interno
            nao). Ver components/MorolarLogoutButton.tsx. */}
        <MorolarLogoutButton />
      </header>
      <TabsNav />
      <main className="mt-6">{children}</main>
    </div>
  );
}
