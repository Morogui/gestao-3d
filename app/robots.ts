import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
          rules: {
                  userAgent: "*",
                  allow: "/",
          },
          sitemap: "https://www.escala7x7ecommerce.com.br/sitemap.xml",
    };
}
