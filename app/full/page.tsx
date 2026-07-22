"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Status = "loading" | "ready" | "erro" | "desconectado";

interface LinhaFull {
  placaId: number;
  numero: number;
  nome: string;
  tier: "A" | "B" | "C";
  skuOuKit: string;
  estoqueLocal: number;
  vendidoFull7d: number;
  estoqueFullAtual: number;
  atualizadoEm: string | null;
  recomendacaoEnvio: number;
}

// Aba Full: acompanha o estoque que você tem hoje no Full (controlado
// manualmente aqui — a API da ML não expõe isso sem uma integração de
// Fulfillment separada) e recomenda quanto enviar de reposição na
// próxima segunda-feira, com base no que vendeu no Full nos últimos 7
// dias (mesmo critério do "Lembrete Full" da aba Produção).
export default function FullPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linhas, setLinhas] = useState<LinhaFull[]>([]);
  const [periodo, setPeriodo] = useState<{ inicio: string; fim: string } | null>(null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<Record<number, boolean>>({});

  async function carregar() {
    try {
      const res = await fetch("/api/estoque-full");
      const data = await res.json();
      if (!data.connected) {
        setStatus("desconectado");
        return;
      }
      if (data.error) {
        setStatus("erro");
        return;
      }
      setLinhas(data.linhas);
      setPeriodo(data.periodo);
      setStatus("ready");
    } catch {
      setStatus("erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const linhasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter(
      (l) =>
        l.nome.toLowerCase().includes(termo) ||
        l.skuOuKit.toLowerCase().includes(termo)
    );
  }, [linhas, busca]);

  async function ajustarFull(placaId: number, delta: number) {
    if (!delta) return;
    setSalvando((prev) => ({ ...prev, [placaId]: true }));
    try {
      const res = await fetch("/api/estoque-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placaId, delta }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setLinhas((prev) =>
          prev.map((l) =>
            l.placaId === placaId
              ? {
                  ...l,
                  estoqueFullAtual: atualizado.quantidade_pecas,
                  atualizadoEm: atualizado.atualizado_em,
                }
              : l
          )
        );
      }
    } finally {
      setSalvando((prev) => ({ ...prev, [placaId]: false }));
    }
  }

  if (status === "desconectado") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="mb-2 font-medium text-gray-900">Conecte a aba Vendas primeiro</p>
        <p className="mb-4 text-sm text-gray-500">
          A venda no Full vem dos pedidos da aba Vendas — conecte sua conta
          do Mercado Livre por lá antes de continuar.
        </p>
        <Link
          href="/vendas"
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Ir para Vendas
        </Link>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando estoque do Full...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar — a sessão da ML pode ter expirado. Reconecte
        na aba Vendas.
      </div>
    );
  }

  const totalVendidoFull = linhasFiltradas.reduce((s, l) => s + l.vendidoFull7d, 0);
  const totalEstoqueFull = linhasFiltradas.reduce((s, l) => s + l.estoqueFullAtual, 0);
  const totalAEnviar = linhasFiltradas.reduce((s, l) => s + l.recomendacaoEnvio, 0);
  const pendentes = linhasFiltradas.filter((l) => l.recomendacaoEnvio > 0).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Peças vendidas no Full (7d)" value={String(totalVendidoFull)} />
        <Card label="Estoque atual no Full" value={String(totalEstoqueFull)} />
        <Card label="Total a enviar" value={String(totalAEnviar)} />
        <Card label="SKUs pendentes de envio" value={String(pendentes)} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Como funciona a recomendação</p>
        <p className="mt-1">
          &quot;A enviar&quot; = peças vendidas no Full nos últimos 7 dias
          (período {periodo?.inicio} a {periodo?.fim}) — repor 1:1 o que
          saiu, mesmo critério já usado no lembrete de Full da aba
          Produção. &quot;Estoque no Full&quot; é controlado manualmente
          aqui (a API da ML ainda não está integrada com o estoque de
          Fulfillment) — atualize esse número sempre que consultar o
          painel de estoque Full no site da ML, pra recomendação ficar
          mais precisa.
        </p>
      </div>

      <div>
        <input
          type="text"
          placeholder="Buscar por nome ou SKU..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Placa / SKU</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2 text-right">Vendido no Full (7d)</th>
              <th className="px-3 py-2 text-right">Estoque no Full</th>
              <th className="px-3 py-2">Ajustar estoque Full</th>
              <th className="px-3 py-2 text-right">A enviar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhasFiltradas
              .slice()
              .sort((a, b) => b.recomendacaoEnvio - a.recomendacaoEnvio)
              .map((linha) => (
                <LinhaFullRow
                  key={linha.placaId}
                  linha={linha}
                  salvando={Boolean(salvando[linha.placaId])}
                  onAjustar={(delta) => ajustarFull(linha.placaId, delta)}
                />
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function TierBadge({ tier }: { tier: "A" | "B" | "C" }) {
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-xs font-semibold " +
        (tier === "A"
          ? "bg-green-100 text-green-700"
          : tier === "B"
          ? "bg-blue-100 text-blue-700"
          : "bg-gray-100 text-gray-600")
      }
    >
      {tier}
    </span>
  );
}

function LinhaFullRow({
  linha,
  salvando,
  onAjustar,
}: {
  linha: LinhaFull;
  salvando: boolean;
  onAjustar: (delta: number) => void;
}) {
  const [valor, setValor] = useState("");

  return (
    <tr className={"hover:bg-gray-50 " + (linha.recomendacaoEnvio > 0 ? "" : "")}>
      <td className="px-3 py-2">
        <p className="font-medium text-gray-900">{linha.nome}</p>
        <p className="text-xs text-gray-400">{linha.skuOuKit.split("|")[0].trim()}</p>
      </td>
      <td className="px-3 py-2">
        <TierBadge tier={linha.tier} />
      </td>
      <td className="px-3 py-2 text-right text-gray-700">{linha.vendidoFull7d}</td>
      <td className="px-3 py-2 text-right font-medium text-gray-900">
        {linha.estoqueFullAtual}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            placeholder="+/- qtd"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="w-24 rounded border border-gray-300 px-2 py-1 text-xs"
          />
          <button
            disabled={salvando || !valor || Number(valor) === 0}
            onClick={() => {
              onAjustar(Number(valor));
              setValor("");
            }}
            className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      </td>
      <td
        className={
          "px-3 py-2 text-right font-semibold " +
          (linha.recomendacaoEnvio > 0 ? "text-amber-700" : "text-gray-400")
        }
      >
        {linha.recomendacaoEnvio}
      </td>
    </tr>
  );
}
