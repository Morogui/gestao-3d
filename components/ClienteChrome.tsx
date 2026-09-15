"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import ClienteLogoutButton from "./ClienteLogoutButton";

const LABELS: Record<string, string> = {
  vendas: "Vendas",
  full: "Full",
  produtos: "Produtos",
  precificacao: "Precificação",
};

// Chrome (header + nav) da area de cliente externo. So mostra as abas
// que estao em abasPermitidas (ex: Plez Store = so Vendas e Full) e fica
// oculto na propria tela de login. Pedido do Guilherme em 2026-09-14.
export default function ClienteChrome({
  nome,
  slug,
  abas,
  children,
}: {
  nome: string;
  slug: string;
  abas: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLogin = pathname === `/${slug}/login`;

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ color: "#fff", fontWeight: 700, fontSize: 18 }}>{nome}</span>
          <nav style={{ display: "flex", gap: 16 }}>
            {abas.map((aba) => (
              <Link
                key={aba}
                href={`/${slug}/${aba}`}
                style={{
                  color: pathname === `/${slug}/${aba}` ? "#f97316" : "#94a3b8",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                {LABELS[aba] || aba}
              </Link>
            ))}
          </nav>
        </div>
        <ClienteLogoutButton slug={slug} />
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
