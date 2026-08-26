"use client";

import { useEffect, useMemo, useState } from "react";

// Aba "Produtos" — pedido do Guilherme em 2026-08-26: "vai ser onde
// vamos ter cadastrado todos os nossos produtos e como ele é composto".
// Lê /api/produtos/catalogo, que junta sku_placa (SKU real de venda) com
// placas (catálogo de produção) — cada linha da tabela abaixo é uma SKU
// já cadastrada, mostrando de quais placas ela é composta (corpo,
// gancho, ou peça única) e quantas peças de cada uma saem por unidade
// vendida.

interface Componente {
  placaId: number;
  placaNumero: number;
  placaNome: string;
  papel: "corpo" | "gancho" | null;
  grupoComposto: string | null;
  pecasPorUnidade: number;
  tier: "A" | "B" | "C" | string;
  tipo: "direta" | "composto" | string;
  pesoPlacaGramas: number | null;
  tempoPlacaHoras: number;
  descontinuada: boolean;
  estoque: number;
}

interface ProdutoRow {
  sku: string;
  componentes: Componente[];
}

interface PlacaSemSku {
  placaId: number;
  placaNumero: number;
  placaNome: string;
  papel: string | null;
  grupoComposto: string | null;
  tier: string;
}

type Status = "loading" | "ready" | "erro";

const LABEL_PAPEL: Record<string, string> = { corpo: "Corpo", gancho: "Gancho" };

function estoqueVendavelDoSku(componentes: Componente[]): number {
  if (componentes.length === 0) return 0;
  return Math.min(
    ...componentes.map((c) =>
      c.pecasPorUnidade > 0 ? Math.floor(c.estoque / c.pecasPorUnidade) : 0
    )
  );
}

export default function ProdutosPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [produtos, setProdutos] = useState<ProdutoRow[]>([]);
  const [placasSemSku, setPlacasSemSku] = useState<PlacaSemSku[]>([]);
  const [busca, setBusca] = useState("");
  const [mostrarDescontinuadas, setMostrarDescontinuadas] = useState(false);

  useEffect(() => {
    fetch("/api/produtos/catalogo")
      .then((r) => r.json())
      .then((data) => {
        setProdutos(data.produtos ?? []);
        setPlacasSemSku(data.placasSemSku ?? []);
        setStatus("ready");
      })
      .catch(() => setStatus("erro"));
  }, []);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      const temDescontinuada = p.componentes.some((c) => c.descontinuada);
      if (temDescontinuada && !mostrarDescontinuadas) return false;
      if (!termo) return true;
      if (p.sku.toLowerCase().includes(termo)) return true;
      return p.componentes.some((c) =>
        c.placaNome.toLowerCase().includes(termo)
      );
    });
  }, [produtos, busca, mostrarDescontinuadas]);

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando catálogo de produtos…
      </div>
    );
  }
  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Erro ao carregar produtos.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Produtos</h1>
          <p className="text-sm text-gray-500">
            Catálogo completo: cada SKU cadastrada e como ela é composta
            (placas, peças por unidade, tier).
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span className="rounded-full bg-gray-100 px-3 py-1">
            {produtos.length} SKUs cadastradas
          </span>
          {placasSemSku.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
              {placasSemSku.length} placas sem SKU vinculado
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por SKU ou nome da placa…"
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={mostrarDescontinuadas}
            onChange={(e) => setMostrarDescontinuadas(e.target.checked)}
          />
          Mostrar descontinuadas
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Composição</th>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2">Estoque vendável</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {produtosFiltrados.map((p) => {
              const vendavel = estoqueVendavelDoSku(p.componentes);
              const tiers = Array.from(new Set(p.componentes.map((c) => c.tier)));
              return (
                <tr key={p.sku} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">
                    {p.sku}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {p.componentes.map((c) => (
                        <div key={c.placaId} className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                            {c.papel ? LABEL_PAPEL[c.papel] ?? c.papel : "Peça única"}
                          </span>
                          <span className="text-gray-800">
                            #{c.placaNumero} {c.placaNome}
                          </span>
                          <span className="text-xs text-gray-500">
                            {c.pecasPorUnidade}× por unidade vendida
                          </span>
                          {c.descontinuada && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-600">
                              descontinuada
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {tiers.join(" / ")}
                  </td>
                  <td className="px-4 py-3 text-gray-800">{vendavel}</td>
                </tr>
              );
            })}
            {produtosFiltrados.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {placasSemSku.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-800">
            Placas cadastradas sem nenhum SKU vinculado
          </h2>
          <p className="mt-1 text-xs text-amber-700">
            Essas placas existem no catálogo de produção mas ainda não têm
            nenhum SKU de venda apontando pra elas.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {placasSemSku.map((pl) => (
              <li
                key={pl.placaId}
                className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs text-amber-800"
              >
                #{pl.placaNumero} {pl.placaNome}
                {pl.papel ? ` (${LABEL_PAPEL[pl.papel] ?? pl.papel})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
