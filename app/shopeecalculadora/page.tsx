import type { Metadata } from "next";
import { PainelPage } from "../painel/page";

export const metadata: Metadata = {
    title: "Calculadora de Taxas da Shopee",
    description:
          "Calcule gratis a taxa, comissao, frete e a margem de lucro ideal para vender na Shopee. Descubra o preco certo para seus produtos em segundos.",
    keywords: [
          "calculadora shopee",
          "taxa shopee",
          "comissao shopee",
          "frete shopee calculadora",
          "precificacao shopee",
        ],
    alternates: {
          canonical: "https://www.escala7x7ecommerce.com.br/shopeecalculadora",
    },
};

export default function ShopeeCalculadoraPage() {
  return <PainelPage plataformaInicial="shopee" />;
}
