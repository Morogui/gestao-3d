"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tela de login do cliente externo (ex: /plez/login). Isolada do login
// da Morolar (app/login) -- posta pra /api/auth/cliente-login, que grava
// um cookie client_session separado. Pedido do Guilherme em 2026-09-14.
export default function ClienteLoginPage({
  params,
}: {
  params: { cliente: string };
}) {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const resp = await fetch("/api/auth/cliente-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: params.cliente, login, senha }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data.error || "Falha no login");
        return;
      }
      const abas: string[] = data.abas || [];
      const destino = abas.includes("vendas") ? "vendas" : abas[0] || "vendas";
      router.push(`/${params.cliente}/${destino}`);
      router.refresh();
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0f172a",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#1e293b",
          padding: 32,
          borderRadius: 12,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 600, textAlign: "center" }}>
          Login
        </h1>
        {erro && <div style={{ color: "#f87171", fontSize: 14 }}>{erro}</div>}
        <input
          type="text"
          placeholder="Usuário"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
          }}
          required
        />
        <input
          type="password"
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
          }}
          required
        />
        <button
          type="submit"
          disabled={carregando}
          style={{
            padding: 10,
            borderRadius: 6,
            border: "none",
            background: "#f97316",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
