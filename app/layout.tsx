import type { Metadata } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";

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
                        <AppChrome>{children}</AppChrome>
                </body>
          </html>
        );
}
