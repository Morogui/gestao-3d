"use client";

import { useState } from "react";

interface RankingProdutoToggle {
  itemId: string;
  titulo: string;
  sku: string;
  quantidade: number;
  pedidos: number;
  plataforma: "ml" | "shopee";
}

interface TopProdutosCardToggleProps {
  periodo: string;
  todas: RankingProdutoToggle[];
  ml: RankingProdutoToggle[];
  shopee: RankingProdutoToggle[];
  // Só mostra os botões Todas/ML/Shopee quando a tela já está no modo
  // "Todas as plataformas" — com um filtro de plataforma específico já
  // selecionado no resto da página, os pedidos já vêm de uma loja só e o
  // toggle não teria o que alternar.
  mostrarToggle: boolean;
}

// Card "Mais vendidos" com toggle Todas/ML/Shopee — pedido do Guilherme
// em 2026-09-09: "nos mais vendidos 7 dias, deixar um botao pra ver
// separado shopee e meli". Troca localmente (useState), sem recarregar a
// página — as 3 listas (todas/ml/shopee) já vêm prontas do servidor.
export default function TopProdutosCardToggle({
  periodo,
  todas,
  ml,
  shopee,
  mostrarToggle,
}: TopProdutosCardToggleProps) {
  const [aba, setAba] = useState<"todas" | "ml" | "shopee">("todas");
  const ranking = aba === "ml" ? ml : aba === "shopee" ? shopee : todas;
  const top = ranking.slice(0, 5);

  const botao = (valor: "todas" | "ml" | "shopee", label: string) => (
    <button
      type="button"
      onClick={() => setAba(valor)}
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-medium " +
        (aba === valor
          ? "bg-blue-600 text-white"
          : "bg-white text-blue-700 hover:bg-blue-100")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-blue-700">Mais vendidos — {periodo}</p>
        {mostrarToggle && (
          <div className="flex shrink-0 gap-1">
            {botao("todas", "Todas")}
            {botao("ml", "ML")}
            {botao("shopee", "Shopee")}
          </div>
        )}
      </div>
      {top.length === 0 ? (
        <p className="mt-1 text-sm text-gray-400">Sem vendas no período</p>
      ) : (
        <ol className="mt-1.5 flex flex-col gap-1">
          {top.map((r, idx) => (
            <li
              key={r.plataforma + r.itemId + idx}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <span className="truncate text-gray-900" title={r.titulo}>
                {idx + 1}. {r.sku || r.titulo}
              </span>
              <span className="valor-sensivel shrink-0 font-semibold text-gray-900">
                {r.quantidade}x
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
