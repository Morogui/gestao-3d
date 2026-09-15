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

interface RecomendacaoItem {
  itemId: string;
  titulo: string;
  quantidadeBase: number;
  curva: "A" | "B" | "C";
  quantidadeRecomendada: number;
}

const CORES_CURVA: Record<string, string> = {
  A: "#22c55e",
  B: "#f59e0b",
  C: "#64748b",
};

export default function ClienteFullPage() {
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sku, setSku] = useState("");
  const [nomeProduto, setNomeProduto] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [dataPlanejada, setDataPlanejada] = useState("");

  // -- Planejar envio: recomendação automática a partir das vendas Full --
  // Pedido do Guilherme em 2026-09-15: escolher janela (1 semana/15 dias)
  // + data, e o sistema monta a recomendação de quanto enviar pro Full
  // com base nas vendas reais, agrupadas por MLB (ver
  // app/api/c/full/recomendacao/route.ts). Cada item entra numa Curva
  // ABC (por volume de venda no Full dentro da janela) e leva um
  // multiplicador por curva -- default Curva A = 1.4x, B = 1.1x,
  // C = 1.0x, mas editável aqui antes de aplicar.
  const [planejarAberto, setPlanejarAberto] = useState(false);
  const [janela, setJanela] = useState<7 | 15>(7);
  const [dataRecomendacao, setDataRecomendacao] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [multA, setMultA] = useState("1.4");
  const [multB, setMultB] = useState("1.1");
  const [multC, setMultC] = useState("1.0");
  const [recomendacao, setRecomendacao] = useState<RecomendacaoItem[] | null>(null);
  const [carregandoRecomendacao, setCarregandoRecomendacao] = useState(false);
  const [erroRecomendacao, setErroRecomendacao] = useState("");
  const [selecionados, setSelecionados] = useState<Record<string, boolean>>({});
  const [quantidadesRecomendacao, setQuantidadesRecomendacao] = useState<Record<string, string>>({});
  const [salvandoRecomendacao, setSalvandoRecomendacao] = useState(false);

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

  async function handleGerarRecomendacao() {
    setCarregandoRecomendacao(true);
    setErroRecomendacao("");
    setRecomendacao(null);
    try {
      const resp = await fetch(
        `/api/c/full/recomendacao?janela=${janela}&ate=${dataRecomendacao}` +
          `&multA=${encodeURIComponent(multA)}&multB=${encodeURIComponent(multB)}&multC=${encodeURIComponent(multC)}`
      );
      const data = await resp.json();
      if (!resp.ok) {
        setErroRecomendacao(data.error || "Erro ao gerar recomendação");
        return;
      }
      const itens: RecomendacaoItem[] = data.itens || [];
      setRecomendacao(itens);
      const sel: Record<string, boolean> = {};
      const qtd: Record<string, string> = {};
      for (const item of itens) {
        sel[item.itemId] = true;
        qtd[item.itemId] = String(item.quantidadeRecomendada);
      }
      setSelecionados(sel);
      setQuantidadesRecomendacao(qtd);
    } catch {
      setErroRecomendacao("Erro ao gerar recomendação");
    } finally {
      setCarregandoRecomendacao(false);
    }
  }

  // Reaplica os multiplicadores de Curva ABC atuais em cima da
  // quantidadeBase já buscada, sem precisar chamar a API da ML de novo --
  // pedido do Guilherme: os multiplicadores tem que ficar editáveis "na
  // hora de planejar". Sobrescreve qualquer ajuste manual feito por
  // linha, por isso é uma ação explícita (botão), não algo automático a
  // cada tecla digitada.
  function handleAplicarMultiplicadores() {
    if (!recomendacao) return;
    const mult: Record<string, number> = {
      A: Number(multA.replace(",", ".")) || 1,
      B: Number(multB.replace(",", ".")) || 1,
      C: Number(multC.replace(",", ".")) || 1,
    };
    const qtd: Record<string, string> = {};
    for (const item of recomendacao) {
      qtd[item.itemId] = String(Math.round(item.quantidadeBase * mult[item.curva]));
    }
    setQuantidadesRecomendacao(qtd);
  }

  async function handleSalvarRecomendacao() {
    if (!recomendacao) return;
    setSalvandoRecomendacao(true);
    try {
      const itensSelecionados = recomendacao.filter((item) => selecionados[item.itemId]);
      for (const item of itensSelecionados) {
        const qtd = Number(quantidadesRecomendacao[item.itemId] ?? item.quantidadeRecomendada);
        if (!qtd || qtd <= 0) continue;
        await fetch("/api/c/full", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: item.itemId,
            nomeProduto: item.titulo,
            quantidade: qtd,
            dataPlanejada: dataRecomendacao,
          }),
        });
      }
      setRecomendacao(null);
      setPlanejarAberto(false);
      carregar();
    } finally {
      setSalvandoRecomendacao(false);
    }
  }

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Planejamento Full</h2>

      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => setPlanejarAberto((v) => !v)}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #f97316",
            background: planejarAberto ? "#f97316" : "transparent",
            color: planejarAberto ? "#fff" : "#f97316",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Planejar envio
        </button>

        {planejarAberto && (
          <div
            style={{
              marginTop: 12,
              padding: 16,
              borderRadius: 8,
              border: "1px solid #334155",
              background: "#0f172a",
            }}
          >
            <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>
              Escolha o período de vendas Full que quer usar como base e a data do envio. A
              gente soma o que você vendeu no Full nesse período, por anúncio, e monta a
              recomendação de quantidade pra enviar.
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setJanela(7)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: janela === 7 ? "#f97316" : "transparent",
                  color: janela === 7 ? "#fff" : "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                Vendas de 1 semana
              </button>
              <button
                onClick={() => setJanela(15)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: janela === 15 ? "#f97316" : "transparent",
                  color: janela === 15 ? "#fff" : "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                Vendas de 15 dias
              </button>
              <input
                type="date"
                value={dataRecomendacao}
                onChange={(e) => setDataRecomendacao(e.target.value)}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "#0f172a",
                  color: "#fff",
                }}
              />
              <button
                onClick={handleGerarRecomendacao}
                disabled={carregandoRecomendacao}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  background: "#22c55e",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: carregandoRecomendacao ? "default" : "pointer",
                  opacity: carregandoRecomendacao ? 0.7 : 1,
                }}
              >
                {carregandoRecomendacao ? "Calculando..." : "Gerar recomendação"}
              </button>
            </div>

            {erroRecomendacao && (
              <p style={{ color: "#f87171", fontSize: 13 }}>{erroRecomendacao}</p>
            )}

            {recomendacao && recomendacao.length === 0 && (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>
                Nenhuma venda Full encontrada nesse período.
              </p>
            )}

            {recomendacao && recomendacao.length > 0 && (
              <>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-end",
                    flexWrap: "wrap",
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 6,
                    background: "#111827",
                    border: "1px solid #1e293b",
                  }}
                >
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      Multiplicador Curva A
                    </label>
                    <input
                      type="text"
                      value={multA}
                      onChange={(e) => setMultA(e.target.value)}
                      style={{
                        width: 70,
                        padding: 6,
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "#0f172a",
                        color: CORES_CURVA.A,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      Multiplicador Curva B
                    </label>
                    <input
                      type="text"
                      value={multB}
                      onChange={(e) => setMultB(e.target.value)}
                      style={{
                        width: 70,
                        padding: 6,
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "#0f172a",
                        color: CORES_CURVA.B,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      Multiplicador Curva C
                    </label>
                    <input
                      type="text"
                      value={multC}
                      onChange={(e) => setMultC(e.target.value)}
                      style={{
                        width: 70,
                        padding: 6,
                        borderRadius: 6,
                        border: "1px solid #334155",
                        background: "#0f172a",
                        color: CORES_CURVA.C,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <button
                    onClick={handleAplicarMultiplicadores}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: "1px solid #334155",
                      background: "transparent",
                      color: "#cbd5e1",
                      cursor: "pointer",
                    }}
                  >
                    Aplicar multiplicadores
                  </button>
                  <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
                    Curva A/B/C = classificação por volume de venda no Full dentro do período
                    (80/15/5% acumulado). Reaplica em cima da quantidade base vendida, sobrescrevendo
                    ajustes manuais feitos linha a linha.
                  </p>
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    color: "#fff",
                    marginBottom: 12,
                  }}
                >
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
                      <th style={{ padding: 8 }}></th>
                      <th style={{ padding: 8 }}>MLB</th>
                      <th style={{ padding: 8 }}>Anúncio</th>
                      <th style={{ padding: 8 }}>Curva</th>
                      <th style={{ padding: 8 }}>Qtd. vendida (base)</th>
                      <th style={{ padding: 8 }}>Qtd. recomendada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recomendacao.map((item) => (
                      <tr key={item.itemId} style={{ borderBottom: "1px solid #1e293b" }}>
                        <td style={{ padding: 8 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selecionados[item.itemId])}
                            onChange={(e) =>
                              setSelecionados((prev) => ({
                                ...prev,
                                [item.itemId]: e.target.checked,
                              }))
                            }
                          />
                        </td>
                        <td style={{ padding: 8, color: "#94a3b8" }}>{item.itemId}</td>
                        <td style={{ padding: 8 }}>{item.titulo}</td>
                        <td style={{ padding: 8 }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#0f172a",
                              background: CORES_CURVA[item.curva] ?? "#64748b",
                            }}
                          >
                            {item.curva}
                          </span>
                        </td>
                        <td style={{ padding: 8, color: "#94a3b8" }}>{item.quantidadeBase}</td>
                        <td style={{ padding: 8 }}>
                          <input
                            type="number"
                            value={quantidadesRecomendacao[item.itemId] ?? ""}
                            onChange={(e) =>
                              setQuantidadesRecomendacao((prev) => ({
                                ...prev,
                                [item.itemId]: e.target.value,
                              }))
                            }
                            style={{
                              width: 80,
                              padding: 6,
                              borderRadius: 6,
                              border: "1px solid #334155",
                              background: "#0f172a",
                              color: "#fff",
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={handleSalvarRecomendacao}
                  disabled={salvandoRecomendacao}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    border: "none",
                    background: "#f97316",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: salvandoRecomendacao ? "default" : "pointer",
                    opacity: salvandoRecomendacao ? 0.7 : 1,
                  }}
                >
                  {salvandoRecomendacao ? "Salvando..." : "Adicionar ao planejamento"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
