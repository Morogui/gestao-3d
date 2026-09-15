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

interface ConfigPrecificacao {
  impostoPct: number;
  adsPctML: number;
  adsPctShopee: number;
  afiliadoPctShopee: number;
  embalagemCusto: number;
  margemDesejadaPct: number;
}

const COMISSAO_ML_CLASSICO_PCT = 11.5;

function taxaPesoML(pesoKg: number): number {
  if (!pesoKg || pesoKg <= 0.3) return 6.5;
  if (pesoKg <= 0.6) return 6.65;
  if (pesoKg <= 1) return 7.5;
  if (pesoKg <= 1.5) return 8;
  if (pesoKg <= 2.5) return 9.5;
  return 12;
}

function comissaoShopeePct(preco: number): number {
  return preco < 80 ? 20 : 14;
}

function taxaFixaShopee(preco: number): number {
  if (preco < 80) return 4;
  if (preco < 100) return 16;
  if (preco < 200) return 20;
  return 26;
}

function formatBRL(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) return "R$ 0,00";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function calcularMargemML(preco: number, pesoKg: number, custoProducao: number, config: ConfigPrecificacao) {
  const comissao = preco * (COMISSAO_ML_CLASSICO_PCT / 100);
  const taxaFixa = taxaPesoML(pesoKg);
  const imposto = preco * (config.impostoPct / 100);
  const ads = preco * (config.adsPctML / 100);
  const embalagem = config.embalagemCusto;
  const lucro = preco - comissao - taxaFixa - imposto - ads - embalagem - custoProducao;
  const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
  return { lucro, margemPct };
}

function calcularMargemShopee(preco: number, custoProducao: number, config: ConfigPrecificacao) {
  const comissao = preco * (comissaoShopeePct(preco) / 100);
  const taxaFixa = taxaFixaShopee(preco);
  const imposto = preco * (config.impostoPct / 100);
  const ads = preco * (config.adsPctShopee / 100);
  const afiliado = preco * (config.afiliadoPctShopee / 100);
  const embalagem = config.embalagemCusto;
  const lucro = preco - comissao - taxaFixa - imposto - ads - afiliado - embalagem - custoProducao;
  const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
  return { lucro, margemPct };
}

function corMargem(pct: number): string {
  if (pct < 5) return "#ef4444";
  if (pct < 15) return "#eab308";
  return "#22c55e";
}

export default function ClientePrecificacaoPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [config, setConfig] = useState<ConfigPrecificacao | null>(null);
  const [carregando, setCarregando] = useState(true);

  function carregar() {
    setCarregando(true);
    Promise.all([
      fetch("/api/c/produtos").then((r) => r.json()),
      fetch("/api/c/precificacao/config").then((r) => r.json()),
    ])
      .then(([produtosData, configData]) => {
        setProdutos(produtosData.produtos || []);
        setConfig(configData.config);
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvarPreco(id: number, campo: "precoVendaML" | "precoVendaShopee", valor: number) {
    setProdutos((prev) => prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
    await fetch(`/api/c/produtos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
  }

  async function salvarConfig(campo: keyof ConfigPrecificacao, valor: number) {
    if (!config) return;
    const novo = { ...config, [campo]: valor };
    setConfig(novo);
    const resp = await fetch("/api/c/precificacao/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
    const data = await resp.json();
    if (data.config) setConfig(data.config);
  }

  if (carregando || !config) {
    return <p style={{ color: "#94a3b8" }}>Carregando...</p>;
  }

  const inputStyle: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "#fff",
    padding: "6px 8px",
    width: 90,
    fontSize: 13,
  };
  const thStyle: React.CSSProperties = {
    padding: 8,
    textAlign: "left",
    color: "#94a3b8",
    fontWeight: 600,
    fontSize: 13,
  };
  const tdStyle: React.CSSProperties = { padding: 8, borderBottom: "1px solid #1e293b" };

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Precificação</h2>

      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 24,
          background: "#0f172a",
          padding: 12,
          borderRadius: 8,
          border: "1px solid #1e293b",
        }}
      >
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Imposto %
          <br />
          <input
            style={inputStyle}
            defaultValue={config.impostoPct}
            onBlur={(e) => salvarConfig("impostoPct", Number(e.target.value.replace(",", ".")) || 0)}
          />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Ads ML %
          <br />
          <input
            style={inputStyle}
            defaultValue={config.adsPctML}
            onBlur={(e) => salvarConfig("adsPctML", Number(e.target.value.replace(",", ".")) || 0)}
          />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Ads Shopee %
          <br />
          <input
            style={inputStyle}
            defaultValue={config.adsPctShopee}
            onBlur={(e) => salvarConfig("adsPctShopee", Number(e.target.value.replace(",", ".")) || 0)}
          />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Afiliado Shopee %
          <br />
          <input
            style={inputStyle}
            defaultValue={config.afiliadoPctShopee}
            onBlur={(e) => salvarConfig("afiliadoPctShopee", Number(e.target.value.replace(",", ".")) || 0)}
          />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Embalagem (R$)
          <br />
          <input
            style={inputStyle}
            defaultValue={config.embalagemCusto}
            onBlur={(e) => salvarConfig("embalagemCusto", Number(e.target.value.replace(",", ".")) || 0)}
          />
        </label>
      </div>

      {produtos.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>
          Nenhum produto cadastrado ainda. Cadastre produtos na aba Produtos primeiro.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #334155" }}>
              <th style={thStyle}>Produto</th>
              <th style={thStyle}>Custo</th>
              <th style={thStyle}>Preço ML</th>
              <th style={thStyle}>Margem ML</th>
              <th style={thStyle}>Preço Shopee</th>
              <th style={thStyle}>Margem Shopee</th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => {
              const precoML = p.precoVendaML || 0;
              const precoShopee = p.precoVendaShopee || 0;
              const ml = calcularMargemML(precoML, p.pesoEnvioKg, p.custoProducao, config);
              const shopee = calcularMargemShopee(precoShopee, p.custoProducao, config);
              return (
                <tr key={p.id}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{p.nome}</div>
                    <div style={{ color: "#64748b", fontSize: 12 }}>{p.sku}</div>
                  </td>
                  <td style={tdStyle}>{formatBRL(p.custoProducao)}</td>
                  <td style={tdStyle}>
                    <input
                      style={inputStyle}
                      defaultValue={p.precoVendaML ?? ""}
                      placeholder="0,00"
                      onBlur={(e) =>
                        salvarPreco(p.id, "precoVendaML", Number(e.target.value.replace(",", ".")) || 0)
                      }
                    />
                  </td>
                  <td style={{ ...tdStyle, color: precoML > 0 ? corMargem(ml.margemPct) : "#64748b" }}>
                    {precoML > 0 ? `${ml.margemPct.toFixed(1)}% (${formatBRL(ml.lucro)})` : "-"}
                  </td>
                  <td style={tdStyle}>
                    <input
                      style={inputStyle}
                      defaultValue={p.precoVendaShopee ?? ""}
                      placeholder="0,00"
                      onBlur={(e) =>
                        salvarPreco(p.id, "precoVendaShopee", Number(e.target.value.replace(",", ".")) || 0)
                      }
                    />
                  </td>
                  <td style={{ ...tdStyle, color: precoShopee > 0 ? corMargem(shopee.margemPct) : "#64748b" }}>
                    {precoShopee > 0 ? `${shopee.margemPct.toFixed(1)}% (${formatBRL(shopee.lucro)})` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
