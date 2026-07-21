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
        <div className="mx-auto max-w-5xl px-4 py-6">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Gestão 3D</h1>
            <p className="text-sm text-gray-500">
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
