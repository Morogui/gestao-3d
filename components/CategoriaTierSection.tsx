"use client";

import { useMemo, useState } from "react";

interface ItemCategoriaTier {
  id: number;
  numero: number;
  nome: string;
  tier: string;
}

// Painel "Categoria (Tier)" — pedido do Guilherme em 2026-09-17: o
// Tier A/B/C/0 que antes aparecia no card "Anúncios do Full sem vendas"
// (aba Full) agora mora aqui, com duas visões: só o que circula pelo
// Full, ou o catálogo geral (ML + Shopee).
export default function CategoriaTierSection({
  fullMercadoLivre,
  geralMlShopee,
}: {
  fullMercadoLivre: ItemCategoriaTier[];
  geralMlShopee: ItemCategoriaTier[];
}) {
  const [visao, setVisao] = useState<"full" | "geral">("full");
  const itens = visao === "full" ? fullMercadoLivre : geralMlShopee;

  const porTier = useMemo(() => {
    const grupos: Record<string, ItemCategoriaTier[]> = { A: [], B: [], C: [] };
    for (const item of itens) {
      const chave = ["A", "B", "C"].includes(item.tier) ? item.tier : "0";
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(item);
    }
    return grupos;
  }, [itens]);

  const ordemTiers = ["A", "B", "C", "0"].filter((t) => porTier[t]?.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Categoria (Tier)</h2>
          <p className="mt-1 text-sm text-gray-500">
            {visao === "full"
              ? "Tier dos produtos que circulam pelo Full (Mercado Livre)."
              : "Tier geral do catálogo — calculado a partir da demanda combinada de Mercado Livre e Shopee."}
          </p>
        </div>
        <div className="flex overflow-hidden rounded border border-gray-300">
          <button
            type="button"
            onClick={() => setVisao("full")}
            className={
              "px-3 py-1.5 text-xs font-medium " +
              (visao === "full"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50")
            }
          >
            Tier Full Mercado Livre
          </button>
          <button
            type="button"
            onClick={() => setVisao("geral")}
            className={
              "border-l border-gray-300 px-3 py-1.5 text-xs font-medium " +
              (visao === "geral"
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50")
            }
          >
            Tier Mercado Livre Geral e Shopee Geral
          </button>
        </div>
      </div>

      {itens.length === 0 ? (
        <p className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-400">
          {visao === "full"
            ? "Nenhum produto com estoque registrado no Full ainda."
            : "Nenhuma placa ativa no catálogo."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {ordemTiers.map((tier) => (
            <div key={tier} className="rounded-md border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <TierBadge tier={tier} />
                <span className="text-xs text-gray-400">{porTier[tier].length} produto(s)</span>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm text-gray-700">
                {porTier[tier]
                  .slice()
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((item) => (
                    <li key={item.id} className="truncate" title={item.nome}>
                      {item.nome}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-xs font-semibold " +
        (tier === "A"
          ? "bg-green-100 text-green-700"
          : tier === "B"
          ? "bg-blue-100 text-blue-700"
          : tier === "C"
          ? "bg-gray-100 text-gray-600"
          : "bg-gray-50 text-gray-400")
      }
    >
      Tier {tier}
    </span>
  );
}
