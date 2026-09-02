import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://www.escala7x7ecommerce.com.br";

return [
  {
    url: baseUrl + "/",
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 1,
  },
  {
    url: baseUrl + "/painel",
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 0.9,
  },
  {
    url: baseUrl + "/mercadolivrecalculadora",
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.8,
  },
  {
    url: baseUrl + "/shopeecalculadora",
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.8,
  },
  ];
}
