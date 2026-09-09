"use client";

import { useState, ReactNode } from "react";

interface VendasTabSwitchProps {
  pedidosView: ReactNode;
  rankingView: ReactNode;
  margemView: ReactNode;
}

// Alterna entre as 3 visões da seção "Pedidos" da aba Vendas: pedidos
// (lista crua, inclui cancelados p/ auditoria), ranking (mais
// vendidos) e margem (lucro real por pedido — novo, pedido do
// Guilherme em 2026-09-08).
export default function VendasTabSwitch({
  pedidosView,
  rankingView,
  margemView,
}: VendasTabSwitchProps) {
  const [aba, setAba] = useState<"pedidos" | "ranking" | "margem">("pedidos");

  const botao = (valor: "pedidos" | "ranking" | "margem", label: string) => (
    <button
      onClick={() => setAba(valor)}
      className={`rounded-md px-3 py-1 text-sm font-medium ${
        aba === valor
          ? "bg-neutral-900 text-white"
          : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex gap-2">
        {botao("pedidos", "Pedidos")}
        {botao("ranking", "Ranking")}
        {botao("margem", "Margem")}
      </div>
      {aba === "pedidos" ? pedidosView : aba === "ranking" ? rankingView : margemView}
    </div>
  );
}
