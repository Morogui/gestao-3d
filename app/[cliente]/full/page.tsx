"use client";

import { useEffect, useState } from "react";

interface Envio {
  id: number;
  sku: string;
  nomeProduto: string;
  quantidade: number;
  dataPlanejada: string | null;
  status: string;
  criadoEm: string;
}

export default function ClienteFullPage() {
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sku, setSku] = useState("");
  const [nomeProduto, setNomeProduto] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [dataPlanejada, setDataPlanejada] = useState("");

  async function carregar() {
    setCarregando(true);
    const resp = await fetch("/api/c/full");
    const data = await resp.json();
    setEnvios(data.envios || []);
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function handleAdicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!sku || !nomeProduto || !quantidade) return;
    await fetch("/api/c/full", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        nomeProduto,
        quantidade: Number(quantidade),
        dataPlanejada: dataPlanejada || null,
      }),
    });
    setSku("");
    setNomeProduto("");
    setQuantidade("");
    setDataPlanejada("");
    carregar();
  }

  async function handleExcluir(id: number) {
    await fetch(`/api/c/full/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Planejamento Full</h2>

      <form
        onSubmit={handleAdicionar}
        style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}
      >
        <input
          placeholder="SKU"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          style={{
            padding: 8,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
          }}
        />
        <input
          placeholder="Produto"
          value={nomeProduto}
          onChange={(e) => setNomeProduto(e.target.value)}
          style={{
            padding: 8,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
          }}
        />
        <input
          type="number"
          placeholder="Quantidade"
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          style={{
            padding: 8,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
            width: 120,
          }}
        />
        <input
          type="date"
          value={dataPlanejada}
          onChange={(e) => setDataPlanejada(e.target.value)}
          style={{
            padding: 8,
            borderRadius: 6,
            border: "1px solid #334155",
            background: "#0f172a",
            color: "#fff",
          }}
        />
        <button
          type="submit"
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "none",
            background: "#f97316",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Adicionar
        </button>
      </form>

      {carregando ? (
        <p style={{ color: "#94a3b8" }}>Carregando...</p>
      ) : envios.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Nenhum envio planejado ainda.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
              <th style={{ padding: 8 }}>SKU</th>
              <th style={{ padding: 8 }}>Produto</th>
              <th style={{ padding: 8 }}>Quantidade</th>
              <th style={{ padding: 8 }}>Data planejada</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {envios.map((env) => (
              <tr key={env.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: 8 }}>{env.sku}</td>
                <td style={{ padding: 8 }}>{env.nomeProduto}</td>
                <td style={{ padding: 8 }}>{env.quantidade}</td>
                <td style={{ padding: 8 }}>
                  {env.dataPlanejada
                    ? new Date(env.dataPlanejada).toLocaleDateString("pt-BR")
                    : "—"}
                </td>
                <td style={{ padding: 8 }}>{env.status}</td>
                <td style={{ padding: 8 }}>
                  <button
                    onClick={() => handleExcluir(env.id)}
                    style={{
                      background: "transparent",
                      border: "1px solid #334155",
                      color: "#f87171",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor: "pointer",
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
