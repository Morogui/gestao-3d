"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/custo", label: "Custo" },
  { href: "/vendas", label: "Vendas" },
  { href: "/producao", label: "Produção" },
  { href: "/estoque", label: "Estoque" },
  { href: "/full", label: "Full" },
  { href: "/financeiro", label: "Financeiro" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/analise", label: "Análise" },
  // Painel master de clientes (/admin/clientes) -- pedido do Guilherme
  // em 2026-09-14: administrar as contas externas (ex: Plez Store) e
  // escolher quais abas cada uma enxerga. So a Morolar chega nessa aba
  // (ver middleware.ts, exige g3d_session); ClienteChrome.tsx (nav dos
  // clientes externos) e um componente totalmente separado que nunca
  // mostra esse link.
  { href: "/admin/clientes", label: "Clientes" },
];

export default function TabsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-2 border-b border-gray-200">
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
              active
                ? "border-blue-600 text-blue-600 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
