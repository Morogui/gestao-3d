"use client";

import { useState } from "react";

// Botão pra borrar os números de venda/pedidos/recorde antes de tirar
// print pra mandar pra alguém — pedido do Guilherme em 2026-07-25. Só
// visual/local (useState, some ao recarregar a página): não mexe em
// nenhum dado real, nenhum pedido é apagado. Funciona marcando os
// elementos sensíveis com a classe "valor-sensivel" (nos cards de
// resumo/recorde/mais vendidos) e aplicando blur via seletor filho
// quando o botão está ativo.
export default function OcultarNumeros({ children }: { children: React.ReactNode }) {
  const [oculto, setOculto] = useState(false);

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          onClick={() => setOculto((v) => !v)}
          className={
            "rounded-md border px-3 py-1.5 text-xs font-medium " +
            (oculto
              ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
              : "border-gray-300 text-gray-700 hover:bg-gray-50")
          }
        >
          {oculto ? "Mostrar números" : "Ocultar números (pra print)"}
        </button>
      </div>
      <div
        className={
          oculto
            ? "[&_.valor-sensivel]:rounded [&_.valor-sensivel]:blur-sm [&_.valor-sensivel]:select-none"
            : ""
        }
      >
        {children}
      </div>
    </div>
  );
}
