"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface AdsInvestimentoFormProps {
  dia: string; // YYYY-MM-DD (hoje, no fuso do servidor)
  mlInicial: number;
  shopeeInicial: number;
}

// Formulário pequeno pra lançar manualmente quanto foi investido em Ads
// (Mercado Ads / Shopee Ads) no dia de hoje. Ver lib/ads-investimento.ts
// pra entender por que isso é manual e não puxado direto da API.
export default function AdsInvestimentoForm({
  dia,
  mlInicial,
  shopeeInicial,
}: AdsInvestimentoFormProps) {
  const router = useRouter();
  const [ml, setMl] = useState(String(mlInicial || ""));
  const [shopee, setShopee] = useState(String(shopeeInicial || ""));
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  async function salvar() {
    setSalvando(true);
    setSalvo(false);
    try {
      await fetch("/api/ads-investimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dia,
          ml: Number(ml.replace(",", ".")) || 0,
          shopee: Number(shopee.replace(",", ".")) || 0,
        }),
      });
      setSalvo(true);
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
      <div className="font-medium text-neutral-700">
        Investimento em Ads hoje ({dia})
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <span className="text-neutral-500">Mercado Livre R$</span>
          <input
            type="text"
            inputMode="decimal"
            value={ml}
            onChange={(e) => setMl(e.target.value)}
            className="w-24 rounded border border-neutral-300 px-2 py-1"
            placeholder="0,00"
          />
        </label>
        <label className="flex items-center gap-1">
          <span className="text-neutral-500">Shopee R$</span>
          <input
            type="text"
            inputMode="decimal"
            value={shopee}
            onChange={(e) => setShopee(e.target.value)}
            className="w-24 rounded border border-neutral-300 px-2 py-1"
            placeholder="0,00"
          />
        </label>
        <button
          onClick={salvar}
          disabled={salvando}
          className="rounded-md bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
        {salvo && !salvando && (
          <span className="text-green-600">Salvo ✓</span>
        )}
      </div>
    </div>
  );
}
