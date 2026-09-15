"use client";

import { useEffect, useState } from "react";

interface Cliente {
  id: string;
  nome: string;
  login: string;
  abasPermitidas: string[];
}

const ABAS: { value: string; label: string }[] = [
  { value: "vendas", label: "Vendas (conectar Mercado Livre + ver pedidos)" },
  { value: "full", label: "Full (planejar envios pro Full)" },
];

// Painel master de clientes -- pedido do Guilherme em 2026-09-14:
// "conseguir administrar as contas que eu for colocando no sistema, e
// la eu conseguir liberar o que o cliente vai ter". So acessivel com
// sessao da Morolar (g3d_session) -- ver middleware.ts, que exige isso
// pra qualquer rota fora da area publica/cliente, e app/api/admin/*, que
// segue a mesma regra.
//
// Cada cliente criado aqui ja funciona igual a Plez Store: loga em
// /login com o proprio usuario/senha, e nas abas liberadas consegue
// conectar a PROPRIA conta do Mercado Livre (isolada da Morolar e de
// qualquer outro cliente -- ver lib/client-ml-auth.ts) e gerir o que
// enviar pro Full (lib/client-full.ts). Esse painel so cria a conta e
// escolhe quais abas ela enxerga; a conexao com o ML e feita pelo
// proprio cliente, dentro da area dele.
export default function AdminClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Form de criacao
  const [novoSlug, setNovoSlug] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoLogin, setNovoLogin] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novasAbas, setNovasAbas] = useState<string[]>(["vendas", "full"]);

  // Estado de edicao por cliente (abas + reset de senha), chaveado por id
  const [edicoes, setEdicoes] = useState<Record<string, { nome: string; abas: string[]; senha: string }>>({});

  function carregar() {
    setCarregando(true);
    fetch("/api/admin/clientes")
      .then((r) => r.json())
      .then((data) => {
        const lista: Cliente[] = data.clientes || [];
        setClientes(lista);
        const map: Record<string, { nome: string; abas: string[]; senha: string }> = {};
        for (const c of lista) {
          map[c.id] = { nome: c.nome, abas: c.abasPermitidas, senha: "" };
        }
        setEdicoes(map);
      })
      .catch(() => setErro("Erro ao carregar clientes"))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  function toggleAba(lista: string[], aba: string): string[] {
    return lista.includes(aba) ? lista.filter((a) => a !== aba) : [...lista, aba];
  }

  async function criarNovoCliente(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!novoSlug || !novoNome || !novoLogin || !novaSenha) {
      setErro("Preencha todos os campos");
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/admin/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: novoSlug.trim().toLowerCase(),
          nome: novoNome.trim(),
          login: novoLogin.trim(),
          senha: novaSenha,
          abasPermitidas: novasAbas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.error || "Erro ao criar cliente");
        return;
      }
      setNovoSlug("");
      setNovoNome("");
      setNovoLogin("");
      setNovaSenha("");
      setNovasAbas(["vendas", "full"]);
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao(id: string) {
    const edicao = edicoes[id];
    if (!edicao) return;
    setSalvando(true);
    setErro("");
    try {
      const res = await fetch(`/api/admin/clientes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: edicao.nome,
          abasPermitidas: edicao.abas,
          senha: edicao.senha || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data.error || "Erro ao salvar");
        return;
      }
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", color: "#fff" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Clientes</h1>
      <p style={{ color: "#94a3b8", marginBottom: 24, fontSize: 14 }}>
        Contas externas (ex: Plez Store) que acessam uma versão enxuta do sistema em
        /&lt;slug&gt;, com login próprio e só as abas liberadas aqui.
      </p>

      {erro && (
        <p style={{ color: "#f87171", marginBottom: 16, fontSize: 14 }}>{erro}</p>
      )}

      <div
        style={{
          background: "#131318",
          border: "1px solid #23232b",
          borderRadius: 12,
          padding: 20,
          marginBottom: 32,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Novo cliente</h2>
        <form onSubmit={criarNovoCliente} style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
              Slug (usado na URL, ex: plez)
            </label>
            <input
              value={novoSlug}
              onChange={(e) => setNovoSlug(e.target.value)}
              placeholder="plez"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
              Nome do cliente
            </label>
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Plez Store"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
              Usuário de login
            </label>
            <input
              value={novoLogin}
              onChange={(e) => setNovoLogin(e.target.value)}
              placeholder="Plez"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
              Senha
            </label>
            <input
              type="text"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="senha inicial"
              style={inputStyle}
            />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 6 }}>
              Abas liberadas
            </label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {ABAS.map((aba) => (
                <label key={aba.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e2e8f0" }}>
                  <input
                    type="checkbox"
                    checked={novasAbas.includes(aba.value)}
                    onChange={() => setNovasAbas(toggleAba(novasAbas, aba.value))}
                  />
                  {aba.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <button
              type="submit"
              disabled={salvando}
              style={{
                background: "#f97316",
                color: "#000",
                fontWeight: 600,
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                opacity: salvando ? 0.6 : 1,
              }}
            >
              {salvando ? "Salvando..." : "Criar cliente"}
            </button>
          </div>
        </form>
      </div>

      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Clientes cadastrados</h2>
      {carregando && <p style={{ color: "#94a3b8" }}>Carregando...</p>}
      {!carregando && clientes.length === 0 && (
        <p style={{ color: "#94a3b8" }}>Nenhum cliente cadastrado ainda.</p>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        {clientes.map((c) => {
          const edicao = edicoes[c.id] || { nome: c.nome, abas: c.abasPermitidas, senha: "" };
          return (
            <div
              key={c.id}
              style={{
                background: "#131318",
                border: "1px solid #23232b",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>/{c.id}</span>
                  <span style={{ color: "#8b8b96", marginLeft: 8, fontSize: 13 }}>
                    usuário: {c.login}
                  </span>
                </div>
              </div>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
                    Nome
                  </label>
                  <input
                    value={edicao.nome}
                    onChange={(e) =>
                      setEdicoes({ ...edicoes, [c.id]: { ...edicao, nome: e.target.value } })
                    }
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 4 }}>
                    Resetar senha (opcional)
                  </label>
                  <input
                    type="text"
                    value={edicao.senha}
                    onChange={(e) =>
                      setEdicoes({ ...edicoes, [c.id]: { ...edicao, senha: e.target.value } })
                    }
                    placeholder="deixe em branco pra manter"
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "block", fontSize: 12, color: "#8b8b96", marginBottom: 6 }}>
                    Abas liberadas
                  </label>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    {ABAS.map((aba) => (
                      <label key={aba.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#e2e8f0" }}>
                        <input
                          type="checkbox"
                          checked={edicao.abas.includes(aba.value)}
                          onChange={() =>
                            setEdicoes({
                              ...edicoes,
                              [c.id]: { ...edicao, abas: toggleAba(edicao.abas, aba.value) },
                            })
                          }
                        />
                        {aba.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <button
                    onClick={() => salvarEdicao(c.id)}
                    disabled={salvando}
                    style={{
                      background: "#1f2937",
                      color: "#fff",
                      fontWeight: 600,
                      padding: "8px 16px",
                      borderRadius: 8,
                      border: "1px solid #334155",
                      cursor: "pointer",
                      opacity: salvando ? 0.6 : 1,
                    }}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#0a0a0d",
  border: "1px solid #23232b",
  borderRadius: 8,
  padding: "8px 10px",
  color: "#fff",
  fontSize: 14,
  outline: "none",
};
