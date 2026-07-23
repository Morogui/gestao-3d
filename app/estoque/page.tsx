"use client";

import { useEffect, useMemo, useState } from "react";
import { PlacaRow } from "@/lib/placas";

type EstoqueRow = PlacaRow & { atualizadoEm: string | null };
type Status = "loading" | "ready" | "erro";

interface SincronizacaoInfo {
  connected: boolean;
  pedidosVerificados?: number;
  combosNovos?: number;
  pecasBaixadas?: number;
}

// Aba Estoque: lista todas as placas (inclusive descontinuadas, como a
// Taça Copa do Mundo — não produzimos mais, mas ainda vende o que
// sobrou) com um campo de ajuste manual. O ajuste escreve direto na
// mesma tabela estoque_placas que a aba Produção lê/credita — então as
// duas telas ficam sempre em sincronia, sem ledger paralelo.
//
// Além do ajuste manual, toda vez que essa aba é aberta ela também
// dispara a sincronização automática de vendas (pedido do Guilherme em
// 2026-07-22: "a baixa deve acontecer assim que a api retornar o pedido
// como enviado") — verifica pedidos recentes da ML/Shopee e desconta do
// estoque os que já saíram pra entrega, sem precisar de ajuste manual
// pra cada venda.
export default function EstoquePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [placas, setPlacas] = useState<EstoqueRow[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<Record<number, boolean>>({});
  const [sincronizando, setSincronizando] = useState(false);
  const [sincronizacao, setSincronizacao] = useState<SincronizacaoInfo | null>(null);

  async function carregar() {
    try {
      const res = await fetch("/api/estoque");
      if (!res.ok) throw new Error("falha");
      setPlacas(await res.json());
      setStatus("ready");
    } catch {
      setStatus("erro");
    }
  }

  async function sincronizarVendas() {
    setSincronizando(true);
    try {
      const res = await fetch("/api/estoque/sincronizar-vendas", { method: "POST" });
      const info = (await res.json()) as SincronizacaoInfo;
      setSincronizacao(info);
      if (info.connected && (info.combosNovos ?? 0) > 0) {
        await carregar();
      }
    } catch {
      setSincronizacao({ connected: false });
    } finally {
      setSincronizando(false);
    }
  }

  useEffect(() => {
    carregar();
    sincronizarVendas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return placas;
    return placas.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        p.skuOuKit.toLowerCase().includes(termo)
    );
  }, [placas, busca]);

  async function ajustarEstoque(placaId: number, delta: number) {
    if (!delta) return;
    setSalvando((prev) => ({ ...prev, [placaId]: true }));
    try {
      const res = await fetch("/api/estoque", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placaId, delta }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setPlacas((prev) =>
          prev.map((p) =>
            p.id === placaId
              ? { ...p, estoque: atualizado.quantidade_pecas, atualizadoEm: atualizado.atualizado_em }
              : p
          )
        );
      }
    } finally {
      setSalvando((prev) => ({ ...prev, [placaId]: false }));
    }
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando estoque...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar o estoque. Tente recarregar a página.
      </div>
    );
  }

  const totalPecas = placasFiltradas.reduce((soma, p) => soma + p.estoque, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card label="Placas cadastradas" value={String(placas.length)} />
        <Card
          label="Descontinuadas (só vender estoque)"
          value={String(placas.filter((p) => p.descontinuada).length)}
        />
        <Card label="Total de peças em estoque" value={String(totalPecas)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <button
          onClick={sincronizarVendas}
          disabled={sincronizando}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar vendas agora"}
        </button>
        {sincronizacao && !sincronizacao.connected && (
          <span className="text-xs text-red-600">
            Não deu pra sincronizar — ML e Shopee parecem desconectados.
            Reconecte na aba Vendas.
          </span>
        )}
        {sincronizacao && sincronizacao.connected && (
          <span className="text-xs text-gray-500">
            {sincronizacao.pedidosVerificados ?? 0} pedido(s) enviado(s)
            verificado(s) (últimos {10} dias) ·{" "}
            <span className="font-medium text-gray-700">
              {sincronizacao.combosNovos ?? 0} baixa(s) nova(s)
            </span>{" "}
            · {sincronizacao.pecasBaixadas ?? 0} peça(s) descontada(s) agora.
          </span>
        )}
      </div>
      <p className="-mt-4 text-xs text-gray-400">
        A baixa automática só desconta pedidos marcados como enviados pela
        API (ML: envio "shipped"/"delivered"; Shopee: status "SHIPPED",
        "TO_CONFIRM_RECEIVE" ou "COMPLETED") — pedido só pago ainda não
        desconta nada. Ela roda sozinha sempre que essa aba é aberta, e
        você também pode forçar com o botão acima. Cada pedido só é
        descontado uma vez, mesmo rodando várias vezes.
      </p>

      <div>
        <input
          type="text"
          placeholder="Buscar por nome ou SKU..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <p className="text-xs text-gray-500">
        O ajuste manual soma (ou subtrai, se você digitar um número
        negativo) ao estoque atual da placa — grava direto na mesma tabela
        que a aba Produção usa, então o número aparece igual nas duas
        telas.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2 text-right">Estoque atual</th>
              <th className="px-3 py-2">Ajuste manual</th>
              <th className="px-3 py-2">Atualizado em</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {placasFiltradas.map((placa) => (
              <LinhaEstoque
                key={placa.id}
                placa={placa}
                salvando={Boolean(salvando[placa.id])}
                onAjustar={(delta) => ajustarEstoque(placa.id, delta)}
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

function LinhaEstoque({
  placa,
  salvando,
  onAjustar,
}: {
  placa: EstoqueRow;
  salvando: boolean;
  onAjustar: (delta: number) => void;
}) {
  const [valor, setValor] = useState("");

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        {/* SKU em cima (negrito) — é o código/descrição real do produto
            (ex: "STAM-01 BEGE | Suporte Organizador..."), o que o
            Guilherme usa pra identificar o item de verdade. O nome
            "amigável" vira legenda embaixo (pedido 2026-07-23: "aqui
            sempre temos que ter a sku nao o nome"). */}
        <p className="font-medium text-gray-900">
          {placa.skuOuKit}
          {placa.descontinuada && (
            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500">
              Descontinuada
            </span>
          )}
        </p>
        <p className="text-xs text-gray-400">
          {placa.nome}
          {placa.tipo === "composto" ? ` · ${placa.papel} de ${placa.grupoComposto}` : ""}
        </p>
      </td>
      <td className="px-3 py-2">
        <TierBadge tier={placa.tier} />
      </td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900">{placa.estoque}</td>
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
      <td className="px-3 py-2 text-xs text-gray-400">
        {placa.atualizadoEm ? new Date(placa.atualizadoEm).toLocaleString("pt-BR") : "—"}
      </td>
    </tr>
  );
}
