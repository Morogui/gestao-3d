"use client";

import { useEffect, useState } from "react";

interface Resumo {
  faturamento: number;
  pedidos: number;
}

interface RankingItem {
  itemId: string;
  titulo: string;
  quantidade: number;
  pedidos: number;
}

interface Modalidades {
  full: number;
  flex: number;
  envioProprio: number;
}

interface VendasData {
  conectado: boolean;
  erro?: boolean;
  hoje?: Resumo;
  periodo?: Resumo & { de: string; ate: string };
  ranking?: RankingItem[];
  modalidades?: Modalidades;
}

function formatBRL(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todaySP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function diasAtras(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00-03:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ClienteVendasPage({
  params,
}: {
  params: { cliente: string };
}) {
  const hoje = todaySP();
  const [carregando, setCarregando] = useState(true);
  const [data, setData] = useState<VendasData | null>(null);
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);

  async function carregar(deQ: string, ateQ: string) {
    setCarregando(true);
    try {
      const resp = await fetch(`/api/c/vendas?de=${deQ}&ate=${ateQ}`);
      const json = await resp.json();
      setData(json);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar(de, ate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const ontem = diasAtras(hoje, 1);
  const semanaInicio = diasAtras(hoje, 6);
  const mesInicio = diasAtras(hoje, 29);

  const btnStyle = (ativo: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 6,
    border: "1px solid #334155",
    background: ativo ? "#f97316" : "transparent",
    color: ativo ? "#fff" : "#cbd5e1",
    cursor: "pointer",
    fontSize: 13,
  });

  if (carregando && !data) {
    return <p style={{ color: "#94a3b8" }}>Carregando...</p>;
  }

  if (data && !data.conectado) {
    return (
      <div style={{ textAlign: "center", marginTop: 64 }}>
        <p style={{ color: "#94a3b8", marginBottom: 16 }}>
          Conecte sua conta do Mercado Livre para ver suas vendas.
        </p>
        <a
          href={`/api/mercadolivre/authorize?cliente=${params.cliente}`}
          style={{
            display: "inline-block",
            background: "#f97316",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 6,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Conectar com Mercado Livre
        </a>
      </div>
    );
  }

  if (data && data.erro) {
    return (
      <p style={{ color: "#f87171" }}>
        Não deu pra buscar as vendas agora (sessão do Mercado Livre pode ter expirado). Tenta
        recarregar a página.
      </p>
    );
  }

  const periodo = data?.periodo;
  const rotuloPeriodo =
    periodo && periodo.de === periodo.ate
      ? new Date(`${periodo.de}T12:00:00-03:00`).toLocaleDateString("pt-BR")
      : periodo
        ? `${new Date(`${periodo.de}T12:00:00-03:00`).toLocaleDateString("pt-BR")} até ${new Date(`${periodo.ate}T12:00:00-03:00`).toLocaleDateString("pt-BR")}`
        : "";

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Vendas</h2>

      <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
        <div
          style={{
            flex: 1,
            padding: 16,
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>Vendas de hoje</p>
          <p style={{ color: "#fff", fontSize: 24, fontWeight: 700, margin: 0 }}>
            {formatBRL(data?.hoje?.faturamento ?? 0)}
          </p>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
            {data?.hoje?.pedidos ?? 0} pedido(s)
          </p>
        </div>
        <div
          style={{
            flex: 1,
            padding: 16,
            borderRadius: 8,
            border: "1px solid #334155",
            background: "#0f172a",
          }}
        >
          <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>
            Vendas em {rotuloPeriodo}
          </p>
          <p style={{ color: "#fff", fontSize: 24, fontWeight: 700, margin: 0 }}>
            {formatBRL(periodo?.faturamento ?? 0)}
          </p>
          <p style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
            {periodo?.pedidos ?? 0} pedido(s)
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button style={btnStyle(de === hoje && ate === hoje)} onClick={() => { setDe(hoje); setAte(hoje); }}>
          Hoje
        </button>
        <button style={btnStyle(de === ontem && ate === ontem)} onClick={() => { setDe(ontem); setAte(ontem); }}>
          Ontem
        </button>
        <button
          style={btnStyle(de === semanaInicio && ate === hoje)}
          onClick={() => { setDe(semanaInicio); setAte(hoje); }}
        >
          Semana
        </button>
        <button
          style={btnStyle(de === mesInicio && ate === hoje)}
          onClick={() => { setDe(mesInicio); setAte(hoje); }}
        >
          Mês
        </button>
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: "1px solid #334155",
          background: "#0f172a",
          marginBottom: 20,
        }}
      >
        <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10 }}>
          Vendas por modalidade de envio — {rotuloPeriodo}
        </p>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
              {data?.modalidades?.full ?? 0}
            </span>
            <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>Full</span>
          </div>
          <div>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
              {data?.modalidades?.flex ?? 0}
            </span>
            <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>Flex</span>
          </div>
          <div>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
              {data?.modalidades?.envioProprio ?? 0}
            </span>
            <span style={{ color: "#64748b", fontSize: 12, marginLeft: 6 }}>Envio próprio</span>
          </div>
        </div>
      </div>

      <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 10 }}>
        Top produtos vendidos — {rotuloPeriodo}
      </p>
      {!data?.ranking || data.ranking.length === 0 ? (
        <p style={{ color: "#94a3b8" }}>Nenhuma venda no período selecionado.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
              <th style={{ padding: 8, width: 32 }}>#</th>
              <th style={{ padding: 8 }}>MLB</th>
              <th style={{ padding: 8 }}>Produto</th>
              <th style={{ padding: 8, textAlign: "right" }}>Pedidos</th>
              <th style={{ padding: 8, textAlign: "right" }}>Qtd. vendida</th>
            </tr>
          </thead>
          <tbody>
            {data.ranking.map((r, idx) => (
              <tr key={r.itemId} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: 8, color: "#64748b" }}>{idx + 1}</td>
                <td style={{ padding: 8, color: "#94a3b8" }}>{r.itemId}</td>
                <td style={{ padding: 8 }}>{r.titulo}</td>
                <td style={{ padding: 8, textAlign: "right", color: "#94a3b8" }}>{r.pedidos}</td>
                <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{r.quantidade}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
