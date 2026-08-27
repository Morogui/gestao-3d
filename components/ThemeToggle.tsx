"use client";

import { useEffect, useState } from "react";

// Botao de alternancia claro/escuro (sol/lua) para a landing page publica
// /painel (Escala 7x7 Ecommerce) - pedido do Guilherme em 2026-08-27.
//
// A pagina inteira ja era desenhada com uma paleta escura fixa (bg quase
// preto, cards cinza-escuro, texto branco/amber), entao o "modo escuro"
// de hoje virou a variante `dark:` no Tailwind (darkMode: "class" no
// tailwind.config.ts) e o "modo claro" e o estado novo/padrao.
//
// Estrategia:
// - Le a preferencia salva em localStorage("theme"): "light" | "dark".
// - Se nao tiver nada salvo, usa prefers-color-scheme do sistema.
// - Aplica/remove a classe "dark" em document.documentElement.
// - Ao clicar, alterna e persiste a escolha em localStorage.
// - Um script inline no topo do JSX de app/painel/page.tsx ja aplica a
//   classe "dark" antes da pintura (evita flash de tema errado); este
//   componente so mantem o estado em sincronia depois que o React monta
//   e cuida do clique do usuario.
export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let dark = false;
    try {
      const stored = localStorage.getItem("theme");
      const prefersDark =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      dark = stored ? stored === "dark" : prefersDark;
    } catch {
      dark = false;
    }
    setIsDark(dark);
    setMounted(true);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage indisponivel (modo privado etc.) - ignora, so nao persiste.
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      suppressHydrationWarning
      className="fixed right-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 shadow-sm transition-colors hover:border-amber-500 hover:text-amber-600 dark:border-[#2c2c36] dark:bg-[#131318] dark:text-[#c8c8d0] dark:hover:text-amber-400"
    >
      <span className="relative block h-5 w-5">
        {/* Sol - visivel no modo escuro (clique para ir pro claro) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          suppressHydrationWarning
          className={
            "absolute inset-0 h-5 w-5 transition-all duration-300 " +
            (mounted && isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0")
          }
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="M4.93 4.93l1.41 1.41" />
          <path d="M17.66 17.66l1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="M6.34 17.66l-1.41 1.41" />
          <path d="M19.07 4.93l-1.41 1.41" />
        </svg>

        {/* Lua - visivel no modo claro (clique para ir pro escuro) */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          suppressHydrationWarning
          className={
            "absolute inset-0 h-5 w-5 transition-all duration-300 " +
            (mounted && isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")
          }
        >
          <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 1 0 20.354 15.354z" />
        </svg>
      </span>
    </button>
  );
}
