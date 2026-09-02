import type { Metadata } from "next";
import { PainelPage } from "../painel/page";

export const metadata: Metadata = {
    title: "Calculadora de Taxas do Mercado Livre",
    description:
          "Calcule gratis a taxa, comissao, frete Flex e a margem de lucro ideal para vender no Mercado Livre. Descubra o preco certo em segundos.",
    keywords: [
          "calculadora mercado livre",
          "taxa mercado livre",
          "comissao mercado livre",
          "frete flex calculadora",
          "precificacao mercado livre",
        ],
    alternates: {
          canonical: "https://www.escala7x7ecommerce.com.br/mercadolivrecalculadora",
    },
};

export default function MercadoLivreCalculadoraPage() {
  return <PainelPage plataformaInicial="ml" />;
}
