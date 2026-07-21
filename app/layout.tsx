import type { Metadata } from "next";
import "./globals.css";
import TabsNav from "@/components/TabsNav";

export const metadata: Metadata = {
  title: "Gestão 3D",
  description: "Sistema de gestão para produção e venda de impressos 3D",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="mx-auto max-w-[1400px] px-4 py-6">
          <header className="mb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Morolar" className="h-10 w-auto" />
            <p className="mt-1 text-sm text-gray-500">
              Custo · Vendas · Produção
            </p>
          </header>
          <TabsNav />
          <main className="mt-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
