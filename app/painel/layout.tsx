import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Calculadora de Precificacao para Marketplace",
    description:
          "Calcule taxas, comissao e margem de lucro para vender na Shopee e Mercado Livre, e o custo de producao 3D. Ferramenta gratuita e completa.",
    alternates: {
          canonical: "https://www.escala7x7ecommerce.com.br/painel",
    },
    icons: {
          icon: "/logo-7x7.png",
          shortcut: "/logo-7x7.png",
          apple: "/logo-7x7.png",
    },
};

const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Escala 7x7",
    url: "https://www.escala7x7ecommerce.com.br/painel",
    description:
          "Calculadora gratuita de precificacao para Shopee e Mercado Livre, e de custo de producao 3D.",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "BRL",
    },
};

export default function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return [
    <script
      key="ld-json"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />,
    children,
    ];
}
