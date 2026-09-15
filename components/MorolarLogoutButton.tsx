"use client";

import { useRouter } from "next/navigation";

// Botao de sair do sistema interno da Morolar (sessao g3d_session). Pedido
// do Guilherme em 2026-09-15: "aqui tem que ter um botao sair, pra eu ou
// qualquer conta de cliente logado, consiga sair do sistema" -- o login de
// cliente externo (ex: Plez Store) ja tinha isso via ClienteLogoutButton +
// ClienteChrome, mas o chrome interno da Morolar (AppChrome.tsx) nunca
// ganhou um botao equivalente. Espelha ClienteLogoutButton.tsx, so troca a
// rota de logout (/api/auth/logout, que limpa g3d_session -- ver
// app/api/auth/logout/route.ts) e o redirecionamento (/login, tela
// unificada desde a unificacao de login em 2026-09-14).
export default function MorolarLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        background: "transparent",
        border: "1px solid #d1d5db",
        color: "#6b7280",
        borderRadius: 6,
        padding: "6px 12px",
        fontSize: 13,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      Sair
    </button>
  );
}
