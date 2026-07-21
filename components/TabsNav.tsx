"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/custo", label: "Custo" },
  { href: "/vendas", label: "Vendas" },
  { href: "/producao", label: "Produção" },
  { href: "/estoque", label: "Estoque" },
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
