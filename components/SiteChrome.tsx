"use client";

import { usePathname } from "next/navigation";
import TabsNav from "./TabsNav";

// A /painel (e a home "/", que reexporta o mesmo componente - ver
// app/page.tsx) e a pagina publica generica do Escala 7x7 Ecommerce -
// pedido do Guilherme: ela precisa funcionar sozinha, sem o
// cabecalho/nav interno do Gestao 3D (que exige login em /custo,
// /vendas etc). Cobre os dois casos porque a home "/" mantem a URL
// "/" mesmo renderizando o conteudo de /painel (export default from
// "./painel/page"), entao usePathname() aqui retorna "/", nao
// "/painel".
export default function SiteChrome({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPainel = pathname === "/" || pathname?.startsWith("/painel");

  if (isPainel) {
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
