"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PlacaRow, estoqueVendavel } from "@/lib/placas";
import {
  MachineRow,
  ProducaoRow,
  DemandaResult,
  DemandaPlacaRow,
} from "@/lib/producao-types";

type Status = "loading" | "ready" | "erro" | "desconectado";

export default function ProducaoPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [placas, setPlacas] = useState<PlacaRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [producoes, setProducoes] = useState<ProducaoRow[]>([]);
  const [demanda, setDemanda] = useState<DemandaResult | null>(null);
  const [carregando, setCarregando] = useState<Record<number, boolean>>({});

  async function carregarTudo() {
    const [placasRes, machinesRes, producoesRes, demandaRes] = await Promise.all([
      fetch("/api/placas").then((r) => r.json()),
      fetch("/api/machines").then((r) => r.json()),
      fetch("/api/producoes").then((r) => r.json()),
      fetch("/api/producao/demanda").then((r) => r.json()),
    ]);

    if (!demandaRes.connected) {
      setStatus("desconectado");
      return;
    }
    if (demandaRes.error) {
      setStatus("erro");
      return;
    }

    setPlacas(placasRes);
    setMachines(machinesRes);
    setProducoes(producoesRes);
    setDemanda(demandaRes);
    setStatus("ready");
  }

  useEffect(() => {
    carregarTudo();
  }, []);

  const vendavelPorGrupo = useMemo(() => estoqueVendavel(placas), [placas]);
  const demandaPorPlaca = useMemo(() => {
    const map = new Map<number, DemandaPlacaRow>();
    for (const d of demanda?.demanda ?? []) map.set(d.placaId, d);
    return map;
  }, [demanda]);

  const producoesEmAndamento = producoes.filter((p) => p.status === "em_andamento");
  const producoesRecentes = producoes.filter((p) => p.status !== "em_andamento").slice(0, 15);

  const totalFullSemana = (demanda?.demanda ?? []).reduce(
    (soma, d) => soma + d.qtyVendidaFull,
    0
  );

  async function iniciarProducao(placaId: number, machineId: number, quantidadePlacas: number) {
    setCarregando((prev) => ({ ...prev, [placaId]: true }));
    try {
      await fetch("/api/producoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, placaId, quantidadePlacas }),
      });
      await carregarTudo();
    } finally {
      setCarregando((prev) => ({ ...prev, [placaId]: false }));
    }
  }

  async function concluirProducao(id: number) {
    await fetch(`/api/producoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "concluida" }),
    });
    await carregarTudo();
  }

  async function cancelarProducao(id: number) {
    await fetch(`/api/producoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelada" }),
    });
    await carregarTudo();
  }

  if (status === "desconectado") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="mb-2 font-medium text-gray-900">Conecte a aba Vendas primeiro</p>
        <p className="mb-4 text-sm text-gray-500">
          A demanda semanal usa os pedidos da aba Vendas — conecte sua conta do
          Mercado Livre por lá antes de continuar.
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
        Carregando estoque e demanda...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar os pedidos da semana — a sessão da ML pode ter
        expirado. Reconecte na aba Vendas.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Pedidos (últimos 7 dias)" value={String(demanda?.totalPedidos ?? 0)} />
        <Card label="Produções em andamento" value={String(producoesEmAndamento.length)} />
        <Card label="Placas cadastradas" value={String(placas.length)} />
        <Card label="Peças vendidas no Full (semana)" value={String(totalFullSemana)} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Lembrete Full</p>
        <p className="mt-1">
          Vendas Full não descontam o estoque local, mas precisam ser repostas —
          use a coluna &quot;Vendido no Full (semana)&quot; abaixo pra saber o que
          incluir no próximo envio (você monta o Full toda segunda-feira).
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Produções em andamento ({producoesEmAndamento.length})
        </h2>
        {producoesEmAndamento.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">
            Nenhuma máquina carregada agora.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Máquina</th>
                  <th className="px-4 py-2">Placa</th>
                  <th className="px-4 py-2 text-right">Qtd. placas</th>
                  <th className="px-4 py-2">Iniciado em</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {producoesEmAndamento.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">{p.machine_nome}</td>
                    <td className="px-4 py-2 text-gray-700">{p.placa_nome}</td>
                    <td className="px-4 py-2 text-right">{p.quantidade_placas}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(p.iniciado_em).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => concluirProducao(p.id)}
                        className="mr-3 text-green-700 hover:underline"
                      >
                        Marcar concluída
                      </button>
                      <button
                        onClick={() => cancelarProducao(p.id)}
                        className="text-red-600 hover:underline"
                      >
                        Cancelar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Estoque de placas e recomendação de produção
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          &quot;A produzir&quot; = (vendido nos últimos 7 dias × multiplicador do
          Tier) − estoque atual. Tier A produz 2.0x a demanda, B 1.3x, C 1.0x.
          Pra placas compostas (corpo+gancho), o estoque &quot;vendável&quot; do
          produto final é o menor entre as duas metades do par.
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Estoque</th>
                <th className="px-3 py-2 text-right">Vendável (grupo)</th>
                <th className="px-3 py-2 text-right">Vendido (7d)</th>
                <th className="px-3 py-2 text-right">Full (7d)</th>
                <th className="px-3 py-2 text-right">A produzir</th>
                <th className="px-3 py-2">Carregar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {placas.map((placa) => {
                const d = demandaPorPlaca.get(placa.id);
                const vendavel = placa.grupoComposto
                  ? vendavelPorGrupo.get(placa.grupoComposto)
                  : undefined;
                return (
                  <PlacaRowView
                    key={placa.id}
                    placa={placa}
                    demanda={d}
                    vendavelGrupo={vendavel}
                    machines={machines.filter((m) => m.ativa)}
                    carregando={Boolean(carregando[placa.id])}
                    onIniciar={(machineId, qtd) =>
                      iniciarProducao(placa.id, machineId, qtd)
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Histórico recente</h2>
        {producoesRecentes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">
            Nenhuma produção concluída ou cancelada ainda.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2">Máquina</th>
                  <th className="px-4 py-2">Placa</th>
                  <th className="px-4 py-2 text-right">Qtd. placas</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Concluído em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {producoesRecentes.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-gray-700">{p.machine_nome}</td>
                    <td className="px-4 py-2 text-gray-700">{p.placa_nome}</td>
                    <td className="px-4 py-2 text-right">{p.quantidade_placas}</td>
                    <td className="px-4 py-2">
                      {p.status === "concluida" ? "Concluída" : "Cancelada"}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {p.concluido_em ? new Date(p.concluido_em).toLocaleString("pt-BR") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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

function PlacaRowView({
  placa,
  demanda,
  vendavelGrupo,
  machines,
  carregando,
  onIniciar,
}: {
  placa: PlacaRow;
  demanda?: { qtyVendidaSemana: number; qtyVendidaFull: number; aProduzir: number };
  vendavelGrupo?: number;
  machines: MachineRow[];
  carregando: boolean;
  onIniciar: (machineId: number, quantidadePlacas: number) => void;
}) {
  const [machineId, setMachineId] = useState<number | "">(machines[0]?.id ?? "");
  const [quantidade, setQuantidade] = useState(1);

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <p className="font-medium text-gray-900">{placa.nome}</p>
        <p className="text-xs text-gray-400">
          {placa.tipo === "composto" ? `${placa.papel} de ${placa.grupoComposto}` : "peça direta"}
          {" · "}
          {placa.pecasPorPlaca} pç/placa · {placa.tempoPlacaHoras}h/placa
        </p>
      </td>
      <td className="px-3 py-2">
        <span
          className={
            "rounded px-1.5 py-0.5 text-xs font-semibold " +
            (placa.tier === "A"
              ? "bg-green-100 text-green-700"
              : placa.tier === "B"
              ? "bg-blue-100 text-blue-700"
              : "bg-gray-100 text-gray-600")
          }
        >
          {placa.tier}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-medium text-gray-900">{placa.estoque}</td>
      <td className="px-3 py-2 text-right text-gray-500">
        {vendavelGrupo ?? "—"}
      </td>
      <td className="px-3 py-2 text-right">{demanda?.qtyVendidaSemana ?? 0}</td>
      <td className="px-3 py-2 text-right text-amber-700">{demanda?.qtyVendidaFull ?? 0}</td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900">
        {demanda?.aProduzir ?? 0}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <select
            value={machineId}
            onChange={(e) => setMachineId(Number(e.target.value))}
            className="rounded border border-gray-300 px-1.5 py-1 text-xs"
          >
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value)))}
            className="w-14 rounded border border-gray-300 px-1.5 py-1 text-xs"
          />
          <button
            disabled={carregando || !machineId}
            onClick={() => machineId && onIniciar(machineId, quantidade)}
            className="rounded bg-gray-900 px-2 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            Carregar
          </button>
        </div>
      </td>
    </tr>
  );
}
