"use client";

import { useEffect, useRef, useState } from "react";

interface Produto {
  id: number;
  sku: string;
  nome: string;
  custoProducao: number;
  pesoEnvioKg: number;
  precoVendaML: number | null;
  precoVendaShopee: number | null;
  extras?: any;
}

// SheetJS carregado sob demanda (CDN) so quando o cliente usa Excel.
function carregarXLSX(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.XLSX) return resolve(w.XLSX);
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => resolve(w.XLSX);
    s.onerror = () => reject(new Error("Falha ao carregar biblioteca de Excel"));
    document.head.appendChild(s);
  });
}

function norm(s: any): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(v: any): number | null {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).replace(/R\$/gi, "").replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
}

export default function ClienteProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoSku, setNovoSku] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoCusto, setNovoCusto] = useState("");
  const [novoPeso, setNovoPeso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
    await fetch("/api/c/produtos/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor }),
    });
  }

  async function excluirProduto(id: number) {
    if (!confirm("Excluir este produto?")) return;
    await fetch("/api/c/produtos/" + id, { method: "DELETE" });
    carregar();
  }

  // Baixa o modelo em Excel ja preenchido com os produtos atuais:
  // serve de modelo vazio (conta nova) e de base pra edicao em massa.
  async function baixarModelo() {
    try {
      const XLSX = await carregarXLSX();
      const cab = ["SKU", "Nome", "Custo (R$)", "Peso envio (kg)", "Preço cheio ML (R$)", "Preço promo ML (R$)", "Preço Shopee (R$)"];
      const linhas = produtos.length
        ? produtos.map((p) => [p.sku, p.nome, p.custoProducao, p.pesoEnvioKg, p.precoVendaML ?? "", p.extras?.precoPromo ?? "", p.precoVendaShopee ?? ""])
        : [["EXEMPLO-001", "Produto de exemplo", 10, 0.3, 59.9, 44.9, 59.9]];
      const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
      ws["!cols"] = [{ wch: 22 }, { wch: 40 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Produtos");
      XLSX.writeFile(wb, "modelo-produtos.xlsx");
    } catch (e: any) {
      alert(e?.message || "Erro ao gerar o modelo");
    }
  }

  // Importa Excel: SKU novo e criado, SKU existente e atualizado.
  // Celula em branco = mantem o valor atual.
  async function importarExcel(file: File) {
    try {
      setProgresso("Lendo planilha...");
      const XLSX = await carregarXLSX();
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rows.length < 2) {
        setProgresso("Planilha vazia.");
        return;
      }
      const cab = rows[0].map(norm);
      const col = (...nomes: string[]) => cab.findIndex((h: string) => nomes.some((n) => h === n || h.startsWith(n)));
      const iSku = col("sku");
      const iNome = col("nome");
      const iCusto = col("custo");
      const iPeso = col("peso");
      const iML = col("precoml", "precocheio", "precomercadolivre");
      const iPromo = col("precopromo");
      const iSH = col("precoshopee");
      if (iSku < 0) {
        setProgresso("Coluna SKU nao encontrada. Baixe o modelo e use as mesmas colunas.");
        return;
      }
      const atuais = new Map<string, Produto>();
      produtos.forEach((p) => atuais.set(p.sku.trim().toLowerCase(), p));
      const dados = rows.slice(1).filter((r) => String(r[iSku] ?? "").trim() !== "");
      let ok = 0;
      let erros = 0;
      for (let k = 0; k < dados.length; k++) {
        const r = dados[k];
        const sku = String(r[iSku]).trim();
        const ex = atuais.get(sku.toLowerCase());
        const nome = (iNome >= 0 && String(r[iNome]).trim()) || ex?.nome || sku;
        const custo = (iCusto >= 0 ? num(r[iCusto]) : null) ?? ex?.custoProducao ?? 0;
        const peso = (iPeso >= 0 ? num(r[iPeso]) : null) ?? ex?.pesoEnvioKg ?? 0;
        const pML = (iML >= 0 ? num(r[iML]) : null) ?? ex?.precoVendaML ?? null;
        const pPromo = (iPromo >= 0 ? num(r[iPromo]) : null) ?? ex?.extras?.precoPromo ?? null;
        const pSH = (iSH >= 0 ? num(r[iSH]) : null) ?? ex?.precoVendaShopee ?? null;
        setProgresso("Importando " + (k + 1) + " de " + dados.length + "...");
        try {
          const res = await fetch("/api/c/produtos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sku, nome, custoProducao: custo, pesoEnvioKg: peso }),
          });
          const j = await res.json();
          const id = j?.produto?.id;
          if (!res.ok || !id) throw new Error("falha");
          if (pML !== null || pSH !== null || pPromo !== null) {
            await fetch("/api/c/produtos/" + id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ precoVendaML: pML, precoVendaShopee: pSH, ...(pPromo !== null ? { extras: { ...(ex?.extras || {}), precoPromo: pPromo } } : {}) }),
            });
          }
          ok++;
        } catch {
          erros++;
        }
      }
      setProgresso("Concluido: " + ok + " SKUs importados/atualizados" + (erros ? ", " + erros + " com erro" : "") + ".");
      carregar();
    } catch (e: any) {
      setProgresso(e?.message || "Erro ao importar a planilha");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
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
  const btnSec: React.CSSProperties = {
    background: "#1e293b",
    color: "#fff",
    border: "1px solid #475569",
    borderRadius: 4,
    padding: "6px 14px",
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Produtos</h2>
      <p style={{ color: "#94a3b8", marginBottom: 16, fontSize: 14 }}>
        Cadastre o SKU, nome e custo de produção de cada produto. Esses dados
        alimentam a aba Precificação. Para subir ou editar em massa, baixe o
        modelo em Excel, preencha e importe de volta (SKU existente é atualizado,
        SKU novo é criado, célula em branco mantém o valor atual).
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12,
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

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={baixarModelo} style={btnSec}>
          Baixar modelo (Excel)
        </button>
        <button onClick={() => fileRef.current?.click()} style={btnSec}>
          Importar planilha (Excel)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importarExcel(f);
          }}
        />
        {progresso && <span style={{ color: "#94a3b8", fontSize: 13 }}>{progresso}</span>}
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
