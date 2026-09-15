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
//
// Estilo segue o mesmo padrao Tailwind claro das outras abas internas
// (ver app/produtos/page.tsx) -- a primeira versao deste arquivo usava
// cores escuras "hardcoded" (copiadas de app/login/page.tsx, que tem
// fundo proprio #0a0a0d) e ficava com titulos/texto brancos invisiveis
// sobre o fundo claro padrao do AppChrome. Corrigido no mesmo dia.
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Clientes</h1>
        <p className="text-sm text-gray-500">
          Contas externas (ex: Plez Store) que acessam uma versão enxuta do sistema em
          /&lt;slug&gt;, com login próprio e só as abas liberadas aqui.
        </p>
      </div>

      {erro && <p className="text-sm text-red-600">{erro}</p>}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Novo cliente</h2>
        <form onSubmit={criarNovoCliente} className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-gray-500">
              Slug (usado na URL, ex: plez)
            </label>
            <input
              value={novoSlug}
              onChange={(e) => setNovoSlug(e.target.value)}
              placeholder="plez"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Nome do cliente</label>
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Plez Store"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Usuário de login</label>
            <input
              value={novoLogin}
              onChange={(e) => setNovoLogin(e.target.value)}
              placeholder="Plez"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">Senha</label>
            <input
              type="text"
              value={novaSenha}
              onChange={(e) => setNovaSenha(e.target.value)}
              placeholder="senha inicial"
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1.5 block text-xs text-gray-500">Abas liberadas</label>
            <div className="flex flex-wrap gap-4">
              {ABAS.map((aba) => (
                <label key={aba.value} className="flex items-center gap-1.5 text-sm text-gray-700">
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
          <div className="col-span-2">
            <button
              type="submit"
              disabled={salvando}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {salvando ? "Salvando..." : "Criar cliente"}
            </button>
          </div>
        </form>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Clientes cadastrados</h2>
        {carregando && <p className="text-sm text-gray-500">Carregando...</p>}
        {!carregando && clientes.length === 0 && (
          <p className="text-sm text-gray-500">Nenhum cliente cadastrado ainda.</p>
        )}
        <div className="flex flex-col gap-3">
          {clientes.map((c) => {
            const edicao = edicoes[c.id] || { nome: c.nome, abas: c.abasPermitidas, senha: "" };
            return (
              <div key={c.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3">
                  <span className="font-mono text-sm font-semibold text-gray-900">/{c.id}</span>
                  <span className="ml-2 text-xs text-gray-500">usuário: {c.login}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">Nome</label>
                    <input
                      value={edicao.nome}
                      onChange={(e) =>
                        setEdicoes({ ...edicoes, [c.id]: { ...edicao, nome: e.target.value } })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Resetar senha (opcional)
                    </label>
                    <input
                      type="text"
                      value={edicao.senha}
                      onChange={(e) =>
                        setEdicoes({ ...edicoes, [c.id]: { ...edicao, senha: e.target.value } })
                      }
                      placeholder="deixe em branco pra manter"
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="mb-1.5 block text-xs text-gray-500">Abas liberadas</label>
                    <div className="flex flex-wrap gap-4">
                      {ABAS.map((aba) => (
                        <label key={aba.value} className="flex items-center gap-1.5 text-sm text-gray-700">
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
                  <div className="col-span-2">
                    <button
                      onClick={() => salvarEdicao(c.id)}
                      disabled={salvando}
                      className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
    </div>
  );
}
