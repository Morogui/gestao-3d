"use client";

import { useEffect, useState } from "react";

interface OrderItem {
  titulo: string;
  sku: string | null;
  quantidade: number;
  precoUnitario: number;
}
interface Order {
  id: number;
  dataCriacao: string;
  status: string;
  total: number;
  itens: OrderItem[];
}

export default function ClienteVendasPage({
  params,
}: {
  params: { cliente: string };
}) {
  const [carregando, setCarregando] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [pedidos, setPedidos] = useState<Order[]>([]);

  useEffect(() => {
    fetch("/api/c/vendas")
      .then((r) => r.json())
      .then((data) => {
        setConectado(Boolean(data.conectado));
        setPedidos(data.pedidos || []);
      })
      .finally(() => setCarregando(false));
  }, []);

  if (carregando) {
    return <p style={{ color: "#94a3b8" }}>Carregando...</p>;
  }

  if (!conectado) {
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

  return (
    <div>
      <h2 style={{ color: "#fff", fontSize: 20, marginBottom: 16 }}>Vendas</h2>
      {pedidos.length === 0 && <p style={{ color: "#94a3b8" }}>Nenhuma venda encontrada.</p>}
      {pedidos.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "#fff" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #334155" }}>
              <th style={{ padding: 8 }}>Pedido</th>
              <th style={{ padding: 8 }}>Data</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Itens</th>
              <th style={{ padding: 8 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id} style={{ borderBottom: "1px solid #1e293b" }}>
                <td style={{ padding: 8 }}>{p.id}</td>
                <td style={{ padding: 8 }}>
                  {new Date(p.dataCriacao).toLocaleDateString("pt-BR")}
                </td>
                <td style={{ padding: 8 }}>{p.status}</td>
                <td style={{ padding: 8 }}>
                  {p.itens.map((it, idx) => (
                    <div key={idx}>
                      {it.quantidade}x {it.titulo} {it.sku ? `(${it.sku})` : ""}
                    </div>
                  ))}
                </td>
                <td style={{ padding: 8 }}>
                  {p.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
