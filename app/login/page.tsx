"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Usuario ou senha incorretos");
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Erro ao conectar. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0d] px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-[#23232b] bg-[#131318] p-8"
      >
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo-7x7.png" alt="7x7 Escala Ecommerce" className="h-12 w-auto" />
          <div>
            <h1 className="text-sm font-semibold text-white">Gestao 3D</h1>
            <p className="text-xs text-[#8b8b96]">Acesse sua conta</p>
          </div>
        </div>

        <label className="mb-1 block text-xs text-[#8b8b96]">Usuario</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          className="mb-4 w-full rounded-lg border border-[#23232b] bg-[#0a0a0d] px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
        />

        <label className="mb-1 block text-xs text-[#8b8b96]">Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-[#23232b] bg-[#0a0a0d] px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
        />

        {error && <p className="mb-4 text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 disabled:opacity-60"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
