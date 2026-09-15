"use client";

import { useEffect, useState } from "react";

interface Produto {
  id: number;
  sku: string;
  nome: string;
  custoProducao: number;
  pesoEnvioKg: number;
  precoVendaML: number | null;
  precoVendaShopee: number | null;
}

export default function ClienteProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoSku, setNovoSku] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoCusto, setNovoCusto] = useState("");
  const [novoPeso, setNovoPeso] = useState("");
  const [salvando, setSalvando] = useState(false);

  function carregar() {
    setCarregando(true);
    fetch("/api/c/produtos")
      .then((r) => r.json())
      .then((data) => setProdutos(data.produtos || []))
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function adicionarProduto() {
    if (!novoSku.trim() || !novoNome.trim()) return;
    setSalvando(true);
    await fetch("/api/c/produtos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku: novoSku,
        nome: novoNome,
        custoProducao: Number(novoCusto.replace(",", ".")) || 0,
        pesoEnvioKg: Number(novoPeso.replace(",", ".")) || 0,
      }),
    });
    setNovoSku("");
    setNovoNome("");
    setNovoCusto("");
    setNovoPeso("");
    setSalvando(false);
    carregar();
  }

  async function salvarCampo(id: number, campo: string, valor: string | number) {
    await fetch(`/api/c/produtos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
  }

  async function excluirProduto(id: number) {
    if (!confirm("Excluir este produto?")) return;
    await fetch(`/api/c/produtos/${id}`, { method: "DELETE" });
    carregar();
  }

  if (carregando) {
    return <p style={{ color: "#94a3b8" }}>Carregando...</p>;
  }

  const thStyle: React.CSSProperties = {
    padding: 8,
    textAlign: "left",
    color: "#94a3b8",
    fontWeight: 600,
    fontSize: 13,
  };
  const tdStyle: React.CSSProperties = { padding: 8, borderBottom: "1px solid #1e293b" };
  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "#fff",
    padding: "6px 8px",
    width: "100%",
    fontSize: 13,
  };

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Produtos</h2>
      <p style={{ color: "#94a3b8", marginBottom: 16, fontSize: 14 }}>
        Cadastre o SKU, nome e custo de produção de cada produto. Esses dados
        alimentam a aba Precificação.
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 24,
          background: "#0f172a",
          padding: 12,
          borderRadius: 8,
          border: "1px solid #1e293b",
          flexWrap: "wrap",
        }}
      >
        <input
          style={{ ...inputStyle, width: 140 }}
          placeholder="SKU"
          value={novoSku}
          onChange={(e) => setNovoSku(e.target.value)}
        />
        <input
          style={{ ...inputStyle, width: 220 }}
          placeholder="Nome do produto"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
        />
        <input
          style={{ ...inputStyle, width: 120 }}
          placeholder="Custo (R$)"
          value={novoCusto}
          onChange={(e) => setNovoCusto(e.target.value)}
        />
        <input
          style={{ ...inputStyle, width: 130 }}
          placeholder="Peso envio (kg)"
          value={novoPeso}
          onChange={(e) => setNovoPeso(e.target.value)}
        />
        <button
          onClick={adicionarProduto}
          disabled={salvando}
          style={{
            background: "#f97316",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "6px 16px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Adicionar
        </button>
      </div>

      {produtos.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Nenhum produto cadastrado ainda.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              <th style={thStyle}>SKU</th>
              <th style={thStyle}>Nome</th>
              <th style={thStyle}>Custo (R$)</th>
              <th style={thStyle}>Peso envio (kg)</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id}>
                <td style={tdStyle}>
                  <input
                    style={inputStyle}
                    defaultValue={p.sku}
                    onBlur={(e) => salvarCampo(p.id, "sku", e.target.value)}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    style={inputStyle}
                    defaultValue={p.nome}
                    onBlur={(e) => salvarCampo(p.id, "nome", e.target.value)}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    style={inputStyle}
                    defaultValue={p.custoProducao}
                    onBlur={(e) =>
                      salvarCampo(p.id, "custoProducao", Number(e.target.value.replace(",", ".")) || 0)
                    }
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    style={inputStyle}
                    defaultValue={p.pesoEnvioKg}
                    onBlur={(e) =>
                      salvarCampo(p.id, "pesoEnvioKg", Number(e.target.value.replace(",", ".")) || 0)
                    }
                  />
                </td>
                <td style={tdStyle}>
                  <button
                    onClick={() => excluirProduto(p.id)}
                    style={{
                      background: "transparent",
                      color: "#ef4444",
                      border: "1px solid #ef4444",
                      borderRadius: 4,
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
