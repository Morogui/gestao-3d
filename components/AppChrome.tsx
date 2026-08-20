"use client";
import { usePathname } from "next/navigation";
import TabsNav from "@/components/TabsNav";

export default function AppChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isHome = pathname === "/";
    if (isHome) {
          return <>{children}</>;
    }
    return (
          <div className="mx-auto max-w-[1400px] px-4 py-6">
                <header className="mb-6">
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
