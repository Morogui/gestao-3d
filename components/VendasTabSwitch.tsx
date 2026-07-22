"use client";

import { ReactNode, useState } from "react";

// Alterna entre duas visões dentro da MESMA página de Vendas (sem
// recarregar/navegar) — "Pedidos" (lista detalhada, como já era) e
// "Ranking de produtos" (quantidade vendida por produto no período
// filtrado). As duas visões já vêm prontas (renderizadas no server,
// usando os mesmos pedidos já buscados pro filtro de data ativo) — este
// componente só decide qual delas mostrar.
export default function VendasTabSwitch({
  pedidosView,
  rankingView,
}: {
  pedidosView: ReactNode;
  rankingView: ReactNode;
}) {
  const [aba, setAba] = useState<"pedidos" | "ranking">("pedidos");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <button
          onClick={() => setAba("pedidos")}
          className={
            "rounded-md px-3 py-1 text-sm font-medium " +
            (aba === "pedidos"
              ? "bg-gray-900 text-white"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50")
          }
        >
          Pedidos
        </button>
        <button
          onClick={() => setAba("ranking")}
          className={
            "rounded-md px-3 py-1 text-sm font-medium " +
            (aba === "ranking"
              ? "bg-gray-900 text-white"
              : "border border-gray-300 text-gray-700 hover:bg-gray-50")
          }
        >
          Ranking de produtos
        </button>
      </div>
      {aba === "pedidos" ? pedidosView : rankingView}
    </div>
  );
}
