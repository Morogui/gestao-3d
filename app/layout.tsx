import type { Metadata } from "next";
import "./globals.css";
import AppChrome from "@/components/AppChrome";

export const metadata: Metadata = {
    metadataBase: new URL("https://www.escala7x7ecommerce.com.br"),
    title: {
      default: "Escala 7x7 - Calculadora de Precificacao Marketplace e Custo de Produto 3D",
          template: "%s | Escala 7x7",
    },
    description:
          "Calculadora gratuita de precificacao para Shopee e Mercado Livre, e de custo de producao 3D - descubra taxas, margem e preco ideal de venda em segundos.",
    keywords: [
          "calculadora precificacao shopee",
          "calculadora precificacao mercado livre",
          "custo produto impressao 3d",
          "taxa shopee",
          "taxa mercado livre",
          "margem de lucro marketplace",
        ],
    robots: { index: true, follow: true },
    openGraph: {
          title: "Escala 7x7 - Calculadora de Precificacao Marketplace",
          description:
                  "Calculadora gratuita de precificacao para Shopee e Mercado Livre, e de custo de producao 3D.",
          url: "https://www.escala7x7ecommerce.com.br/painel",
          siteName: "Escala 7x7",
          locale: "pt_BR",
          type: "website",
          images: ["/logo-7x7.png"],
    },
    twitter: {
          card: "summary",
          title: "Escala 7x7 - Calculadora de Precificacao Marketplace",
          description:
                  "Calculadora gratuita de precificacao para Shopee e Mercado Livre, e de custo de producao 3D.",
          images: ["/logo-7x7.png"],
    },
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
