"use client";

import { useEffect, useState } from "react";
import { taxaPesoML } from "@/lib/precificacao";

interface Extras {
  tipo?: "classico" | "premium";
  comissaoPct?: number;
  usaAds?: boolean;
  usaAfiliado?: boolean;
  afiliadoPct?: number;
  flex?: boolean;
  custoFlex?: number;
  embalagem?: number;
  margemDesejada?: number;
  precoPromo?: number;
  rebate?: number;
}

interface Produto {
  id: number;
  sku: string;
  nome: string;
  custoProducao: number;
  pesoEnvioKg: number;
  precoVendaML: number | null;
  extras: Extras;
}

interface Config {
  impostoPct: number;
  adsPctML: number;
  embalagemCusto: number;
  margemDesejadaPct: number;
}

const COMISSAO_DEFAULT = { classico: 14, premium: 19 };
const FAIXAS = [18.99, 48.99, 78.99, 99.99, 119.99, 149.99, 199.99, Infinity];

function brl(v: number): string {
  if (!Number.isFinite(v)) return "R$ 0,00";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function num(s: string): number {
  return Number(String(s).replace(",", ".")) || 0;
}

function params(p: Produto, cfg: Config) {
  const e = p.extras || {};
  const tipo = e.tipo || "classico";
  return {
    tipo,
    comissaoPct: e.comissaoPct ?? COMISSAO_DEFAULT[tipo],
    usaAds: e.usaAds ?? true,
    usaAfiliado: e.usaAfiliado ?? false,
    afiliadoPct: e.afiliadoPct ?? 5,
    flex: e.flex ?? false,
    custoFlex: e.custoFlex ?? 6,
    reembolsoFlex: e.reembolsoFlex ?? 0,
    embalagem: e.embalagem ?? cfg.embalagemCusto,
    margemDesejada: e.margemDesejada ?? cfg.margemDesejadaPct,
    rebate: e.rebate ?? 0,
  };
}

function calcular(p: Produto, cfg: Config, preco: number) {
  const q = params(p, cfg);
  const comissaoBruta = preco * (q.comissaoPct / 100);
  const comissao = Math.max(0, comissaoBruta - q.rebate);
  const taxaPeso = preco > 0 ? taxaPesoML(p.pesoEnvioKg, preco) : 0;
  const imposto = preco * (cfg.impostoPct / 100);
  const ads = q.usaAds ? preco * (cfg.adsPctML / 100) : 0;
  const afiliado = q.usaAfiliado ? preco * (q.afiliadoPct / 100) : 0;
  const flex = q.flex ? q.custoFlex - q.reembolsoFlex : 0;
  const lucro = preco - comissao - taxaPeso - imposto - ads - afiliado - q.embalagem - flex - p.custoProducao;
  const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
  return { q, comissao, taxaPeso, imposto, ads, afiliado, flex, lucro, margemPct };
}

function sugerido(p: Produto, cfg: Config): number | null {
  const q = params(p, cfg);
  const pct =
    (q.comissaoPct + cfg.impostoPct + (q.usaAds ? cfg.adsPctML : 0) + (q.usaAfiliado ? q.afiliadoPct : 0) + q.margemDesejada) / 100;
  if (pct >= 1) return null;
  const fixo = q.embalagem + (q.flex ? q.custoFlex - q.reembolsoFlex : 0) + p.custoProducao - q.rebate;
  let lo = 0;
  for (const hi of FAIXAS) {
    const taxa = taxaPesoML(p.pesoEnvioKg, Number.isFinite(hi) ? hi : 1000);
    const preco = (fixo + taxa) / (1 - pct);
    if (preco > lo && preco <= hi) return Math.ceil(preco * 100) / 100;
    lo = hi;
  }
  return null;
}

function cor(pct: number): string {
  if (pct < 5) return "#ef4444";
  if (pct < 15) return "#eab308";
  return "#22c55e";
}

export default function ClientePrecificacaoPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<number | null>(null);
  const [busca, setBusca] = useState("");

  function carregar() {
    setCarregando(true);
    Promise.all([
      fetch("/api/c/produtos").then((r) => r.json()),
      fetch("/api/c/precificacao/config").then((r) => r.json()),
    ])
      .then(([pd, cd]) => {
        setProdutos((pd.produtos || []).map((p: any) => ({ ...p, extras: p.extras || {} })));
        setConfig(cd.config);
      })
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvarProduto(id: number, patch: any) {
    setProdutos((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const n: any = { ...p, ...patch };
        if (patch.extras) n.extras = { ...(p.extras || {}), ...patch.extras };
        return n;
      })
    );
    await fetch("/api/c/produtos/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function salvarConfig(campo: keyof Config, valor: number) {
    if (!config) return;
    setConfig({ ...config, [campo]: valor });
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

  const inp: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "#fff",
    padding: "5px 6px",
    width: 64,
    fontSize: 13,
  };
  const th: React.CSSProperties = { padding: 6, textAlign: "left", color: "#94a3b8", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { padding: 6, borderBottom: "1px solid #1e293b", fontSize: 13, verticalAlign: "middle" };

  const filtrados = produtos.filter((p) => {
    const t = busca.trim().toLowerCase();
    return !t || p.nome.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t);
  });

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 4 }}>Precificação — Mercado Livre</h2>
      <p style={{ color: "#64748b", fontSize: 12, marginBottom: 12 }}>
        Comissão padrão de Calçados, Roupas e Bolsas (Clássico 14% / Premium 19%) — ajustável por produto. A taxa de envio por peso usa a tabela oficial do ML.
      </p>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16, background: "#0f172a", padding: 12, borderRadius: 8, border: "1px solid #1e293b" }}>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Imposto %<br />
          <input style={inp} defaultValue={config.impostoPct} onBlur={(e) => salvarConfig("impostoPct", num(e.target.value))} />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Ads ML %<br />
          <input style={inp} defaultValue={config.adsPctML} onBlur={(e) => salvarConfig("adsPctML", num(e.target.value))} />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Embalagem padrão (R$)<br />
          <input style={inp} defaultValue={config.embalagemCusto} onBlur={(e) => salvarConfig("embalagemCusto", num(e.target.value))} />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Margem desejada padrão %<br />
          <input style={inp} defaultValue={config.margemDesejadaPct} onBlur={(e) => salvarConfig("margemDesejadaPct", num(e.target.value))} />
        </label>
        <label style={{ color: "#94a3b8", fontSize: 13 }}>
          Buscar<br />
          <input style={{ ...inp, width: 180 }} value={busca} placeholder="SKU ou nome" onChange={(e) => setBusca(e.target.value)} />
        </label>
      </div>

      {produtos.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Nenhum produto cadastrado ainda. Cadastre produtos na aba Produtos primeiro.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #334155" }}>
                <th style={th}>Produto</th>
                <th style={th}>Custo</th>
                <th style={th}>Peso kg</th>
                <th style={th}>Embal. R$</th>
                <th style={th}>Anúncio</th>
                <th style={th}>Comissão %</th>
                <th style={th}>Ads</th>
                <th style={th}>Afiliado</th>
                <th style={th}>Flex (custo / reembolso)</th>
                <th style={th}>Preço cheio</th>
                <th style={th}>Preço promo (venda)</th>
                <th style={th}>Rebate R$</th>
                <th style={th}>Lucro</th>
                <th style={th}>Margem</th>
                <th style={th}>Margem alvo %</th>
                <th style={th}>Preço sugerido</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((p) => {
                const cheio = p.precoVendaML || 0;
                const promo = p.extras?.precoPromo || 0;
                const preco = promo > 0 ? promo : cheio;
                const r = calcular(p, config, preco);
                const q = r.q;
                const sug = sugerido(p, config);
                return (
                  <>
                    <tr key={p.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 600, cursor: "pointer" }} onClick={() => setAberto(aberto === p.id ? null : p.id)}>
                          {aberto === p.id ? "▾ " : "▸ "}
                          {p.nome}
                        </div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>{p.sku}</div>
                      </td>
                      <td style={td}>{brl(p.custoProducao)}</td>
                      <td style={td}>
                        <input key={"pe" + p.id + p.pesoEnvioKg} style={inp} defaultValue={p.pesoEnvioKg} onBlur={(e) => salvarProduto(p.id, { pesoEnvioKg: num(e.target.value) })} />
                      </td>
                      <td style={td}>
                        <input key={"em" + p.id + q.embalagem} style={inp} defaultValue={q.embalagem} onBlur={(e) => salvarProduto(p.id, { extras: { embalagem: num(e.target.value) } })} />
                      </td>
                      <td style={td}>
                        <select
                          style={{ ...inp, width: 90 }}
                          value={q.tipo}
                          onChange={(e) => salvarProduto(p.id, { extras: { tipo: e.target.value, comissaoPct: COMISSAO_DEFAULT[e.target.value as "classico" | "premium"] } })}
                        >
                          <option value="classico">Clássico</option>
                          <option value="premium">Premium</option>
                        </select>
                      </td>
                      <td style={td}>
                        <input key={"co" + p.id + q.comissaoPct} style={inp} defaultValue={q.comissaoPct} onBlur={(e) => salvarProduto(p.id, { extras: { comissaoPct: num(e.target.value) } })} />
                      </td>
                      <td style={td}>
                        <input type="checkbox" checked={q.usaAds} onChange={(e) => salvarProduto(p.id, { extras: { usaAds: e.target.checked } })} />
                      </td>
                      <td style={td}>
                        <input type="checkbox" checked={q.usaAfiliado} onChange={(e) => salvarProduto(p.id, { extras: { usaAfiliado: e.target.checked } })} />
                        {q.usaAfiliado && (
                          <input key={"af" + p.id + q.afiliadoPct} style={{ ...inp, width: 44, marginLeft: 4 }} defaultValue={q.afiliadoPct} onBlur={(e) => salvarProduto(p.id, { extras: { afiliadoPct: num(e.target.value) } })} />
                        )}
                      </td>
                      <td style={td}>
                        <input type="checkbox" checked={q.flex} onChange={(e) => salvarProduto(p.id, { extras: { flex: e.target.checked } })} />
                        {q.flex && (
                          <input key={"cf" + p.id + q.custoFlex} style={{ ...inp, width: 50, marginLeft: 4 }} defaultValue={q.custoFlex} onBlur={(e) => salvarProduto(p.id, { extras: { custoFlex: num(e.target.value) } })} />
                  <input key={"rf" + p.id + q.reembolsoFlex} title="Reembolso Flex (R$)" placeholder="reemb." style={{ ...inp, width: 56, marginLeft: 4 }} defaultValue={q.reembolsoFlex || ""} onBlur={(e) => salvarProduto(p.id, { extras: { reembolsoFlex: num(e.target.value) } })} />
                        )}
                      </td>
                      <td style={td}>
                        <input key={"pr" + p.id + cheio} style={{ ...inp, width: 80 }} defaultValue={p.precoVendaML ?? ""} placeholder="0,00" onBlur={(e) => salvarProduto(p.id, { precoVendaML: num(e.target.value) })} />
                      </td>
                      <td style={td}>
                        <input key={"pm" + p.id + promo} style={{ ...inp, width: 80 }} defaultValue={promo || ""} placeholder="0,00" onBlur={(e) => salvarProduto(p.id, { extras: { precoPromo: num(e.target.value) } })} />
                      </td>
                      <td style={td}>
                        <input key={"rb" + p.id + q.rebate} style={{ ...inp, width: 64 }} defaultValue={q.rebate || ""} placeholder="0,00" onBlur={(e) => salvarProduto(p.id, { extras: { rebate: num(e.target.value) } })} />
                      </td>
                      <td style={{ ...td, color: preco > 0 ? cor(r.margemPct) : "#64748b" }}>{preco > 0 ? brl(r.lucro) : "-"}</td>
                      <td style={{ ...td, color: preco > 0 ? cor(r.margemPct) : "#64748b", fontWeight: 600 }}>{preco > 0 ? r.margemPct.toFixed(1) + "%" : "-"}</td>
                      <td style={td}>
                        <input key={"ma" + p.id + q.margemDesejada} style={{ ...inp, width: 50 }} defaultValue={q.margemDesejada} onBlur={(e) => salvarProduto(p.id, { extras: { margemDesejada: num(e.target.value) } })} />
                      </td>
                      <td style={td}>
                        {sug !== null ? (
                          <span>
                            {brl(sug)}{" "}
                            <button
                              style={{ background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", fontSize: 12, cursor: "pointer" }}
                              onClick={() => salvarProduto(p.id, { extras: { precoPromo: sug } })}
                            >
                              Usar
                            </button>
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    {aberto === p.id && (
                      <tr key={"d" + p.id}>
                        <td colSpan={16} style={{ ...td, background: "#0b1220" }}>
                          {preco > 0 ? (
                            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13, color: "#cbd5e1" }}>
                              <span>Preço de venda: {brl(preco)}</span>
                              <span>Comissão ({q.comissaoPct}%{q.rebate > 0 ? " - rebate " + brl(q.rebate) : ""}): -{brl(r.comissao)}</span>
                              <span>Envio por peso ({p.pesoEnvioKg} kg): -{brl(r.taxaPeso)}</span>
                              <span>Imposto ({config.impostoPct}%): -{brl(r.imposto)}</span>
                              <span>Ads ({q.usaAds ? config.adsPctML : 0}%): -{brl(r.ads)}</span>
                              <span>Afiliado: -{brl(r.afiliado)}</span>
                              <span>Embalagem: -{brl(q.embalagem)}</span>
                              <span>Flex: -{brl(r.flex)}</span>
                              <span>Custo produto: -{brl(p.custoProducao)}</span>
                              <span style={{ color: cor(r.margemPct), fontWeight: 700 }}>Lucro: {brl(r.lucro)} ({r.margemPct.toFixed(1)}%)</span>
                            </div>
                          ) : (
                            <span style={{ color: "#64748b", fontSize: 13 }}>Informe o Preço promo (ou cheio) ou use o preço sugerido para ver o detalhamento.</span>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
