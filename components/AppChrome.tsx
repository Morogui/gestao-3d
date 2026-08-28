"use client";

import { usePathname } from "next/navigation";
import TabsNav from "@/components/TabsNav";

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

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  if (isPublicLayoutPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Morolar" className="h-10 w-auto" />
        <p className="mt-1 text-sm text-gray-500">
          Custo · Vendas · Produção · Estoque · Full · Financeiro · Relatórios
        </p>
      </header>
      <TabsNav />
      <main className="mt-6">{children}</main>
    </div>
  );
}
