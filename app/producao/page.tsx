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

interface SkuResult {
  sku: string;
  placa_id: number;
  pecas_por_unidade: string;
  placa_nome: string;
  placa_numero: number;
  variacoes: number;
}

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

  const placaPorId = useMemo(() => {
    const map = new Map<number, PlacaRow>();
    for (const p of placas) map.set(p.id, p);
    return map;
  }, [placas]);

  const vendavelPorGrupo = useMemo(() => estoqueVendavel(placas), [placas]);
  const demandaPorPlaca = useMemo(() => {
    const map = new Map<number, DemandaPlacaRow>();
    for (const d of demanda?.demanda ?? []) map.set(d.placaId, d);
    return map;
  }, [demanda]);

  const producoesEmAndamento = producoes.filter((p) => p.status === "em_andamento");
  const producaoPorMachine = useMemo(() => {
    const map = new Map<number, ProducaoRow>();
    for (const p of producoesEmAndamento) map.set(p.machine_id, p);
    return map;
  }, [producoesEmAndamento]);
  const producoesRecentes = producoes.filter((p) => p.status !== "em_andamento").slice(0, 15);

  const totalFullSemana = (demanda?.demanda ?? []).reduce(
    (soma, d) => soma + d.qtyVendidaFull,
    0
  );

  // Fila de prioridade: placas com algo a produzir, ordenadas do maior
  // pro menor "a produzir" — é o que o operador deve carregar a seguir.
  const filaPrioridade = useMemo(() => {
    return placas
      .map((placa) => ({ placa, demanda: demandaPorPlaca.get(placa.id) }))
      .filter((item) => (item.demanda?.aProduzir ?? 0) > 0)
      .sort((a, b) => (b.demanda?.aProduzir ?? 0) - (a.demanda?.aProduzir ?? 0));
  }, [placas, demandaPorPlaca]);

  async function iniciarProducao(placaId: number, machineId: number, quantidadePlacas: number) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch("/api/producoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, placaId, quantidadePlacas }),
      });
      await carregarTudo();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
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

  async function falhaPlaca(id: number, gramas: number) {
    await fetch(`/api/producoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "falha_placa", gramasDesperdicadas: gramas }),
    });
    await carregarTudo();
  }

  async function falhaPeca(id: number, pecaDescricao: string, gramas: number) {
    await fetch(`/api/producoes/${id}/falha-peca`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pecaDescricao, gramas }),
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
        <Card label="Máquinas rodando" value={`${producoesEmAndamento.length}/${machines.length}`} />
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
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Impressoras</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {machines.map((machine) => (
            <PrinterCard
              key={machine.id}
              machine={machine}
              producao={producaoPorMachine.get(machine.id)}
              placaPorId={placaPorId}
              filaPrioridade={filaPrioridade}
              carregando={Boolean(carregando[machine.id])}
              onIniciar={(placaId, qtd) => iniciarProducao(placaId, machine.id, qtd)}
              onConcluir={concluirProducao}
              onCancelar={cancelarProducao}
              onFalhaPlaca={falhaPlaca}
              onFalhaPeca={falhaPeca}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Fila de prioridade ({filaPrioridade.length})
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Ordenada pelo que mais falta produzir (demanda semanal × Tier − estoque
          atual). Use o campo de busca por SKU em cada impressora se quiser
          carregar um produto fora dessa ordem.
        </p>
        {filaPrioridade.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">
            Nada pendente — estoque cobre a demanda da semana.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Placa</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2 text-right">Estoque</th>
                  <th className="px-3 py-2 text-right">A produzir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filaPrioridade.map((item, idx) => (
                  <tr key={item.placa.id}>
                    <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{item.placa.nome}</td>
                    <td className="px-3 py-2">
                      <TierBadge tier={item.placa.tier} />
                    </td>
                    <td className="px-3 py-2 text-right">{item.placa.estoque}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      {item.demanda?.aProduzir ?? 0}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {placas.map((placa) => {
                const d = demandaPorPlaca.get(placa.id);
                const vendavel = placa.grupoComposto
                  ? vendavelPorGrupo.get(placa.grupoComposto)
                  : undefined;
                return (
                  <tr key={placa.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{placa.nome}</p>
                      <p className="text-xs text-gray-400">
                        {placa.tipo === "composto"
                          ? `${placa.papel} de ${placa.grupoComposto}`
                          : "peça direta"}
                        {" · "}
                        {placa.pecasPorPlaca} pç/placa · {placa.tempoPlacaHoras}h/placa
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge tier={placa.tier} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-gray-900">
                      {placa.estoque}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">{vendavel ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{d?.qtyVendidaSemana ?? 0}</td>
                    <td className="px-3 py-2 text-right text-amber-700">
                      {d?.qtyVendidaFull ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      {d?.aProduzir ?? 0}
                    </td>
                  </tr>
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
            Nenhuma produção concluída, cancelada ou com falha ainda.
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
                  <th className="px-4 py-2 text-right">Perdas</th>
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
                      <StatusLabel status={p.status} />
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">
                      {p.status === "falha_placa"
                        ? `${p.gramas_desperdicadas ?? 0}g (placa)`
                        : Number(p.falhas_peca_count) > 0
                        ? `${p.falhas_peca_count} peça(s)`
                        : "—"}
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

function StatusLabel({ status }: { status: ProducaoRow["status"] }) {
  if (status === "concluida") return <span className="text-green-700">Concluída</span>;
  if (status === "cancelada") return <span className="text-gray-500">Cancelada</span>;
  if (status === "falha_placa") return <span className="text-red-600">Falha na placa</span>;
  return <span>{status}</span>;
}

function PrinterCard({
  machine,
  producao,
  placaPorId,
  filaPrioridade,
  carregando,
  onIniciar,
  onConcluir,
  onCancelar,
  onFalhaPlaca,
  onFalhaPeca,
}: {
  machine: MachineRow;
  producao?: ProducaoRow;
  placaPorId: Map<number, PlacaRow>;
  filaPrioridade: { placa: PlacaRow; demanda?: DemandaPlacaRow }[];
  carregando: boolean;
  onIniciar: (placaId: number, quantidadePlacas: number) => void;
  onConcluir: (id: number) => void;
  onCancelar: (id: number) => void;
  onFalhaPlaca: (id: number, gramas: number) => void;
  onFalhaPeca: (id: number, pecaDescricao: string, gramas: number) => void;
}) {
  const [showFalhaPlaca, setShowFalhaPlaca] = useState(false);
  const [showFalhaPeca, setShowFalhaPeca] = useState(false);
  const [gramasPlaca, setGramasPlaca] = useState("");
  const [pecaDescricao, setPecaDescricao] = useState("");
  const [gramasPeca, setGramasPeca] = useState("");

  const placa = producao ? placaPorId.get(producao.placa_id) : undefined;
  const totalPecas =
    producao && placa ? Number(producao.quantidade_placas) * placa.pecasPorPlaca : 0;

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold text-gray-900">{machine.nome}</p>
        <span
          className={
            "rounded-full px-2 py-0.5 text-xs font-medium " +
            (producao ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")
          }
        >
          {producao ? "Rodando" : "Livre"}
        </span>
      </div>

      {producao && placa ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-gray-900">{placa.nome}</p>
            <p className="text-xs text-gray-500">
              {producao.quantidade_placas} placa(s) · {placa.pecasPorPlaca} pç/placa ·{" "}
              {totalPecas} peças no total
            </p>
            <p className="text-xs text-gray-400">
              Carregada em {new Date(producao.iniciado_em).toLocaleString("pt-BR")}
            </p>
            {Number(producao.falhas_peca_count) > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {producao.falhas_peca_count} peça(s) já perdida(s) nessa placa
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onConcluir(producao.id)}
              className="rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              Placa impressa com sucesso
            </button>
            <button
              onClick={() => setShowFalhaPeca((v) => !v)}
              className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
            >
              Falha em peça
            </button>
            <button
              onClick={() => setShowFalhaPlaca((v) => !v)}
              className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Falha na placa
            </button>
            <button
              onClick={() => onCancelar(producao.id)}
              className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:underline"
            >
              Cancelar
            </button>
          </div>

          {showFalhaPeca && (
            <div className="rounded border border-amber-200 bg-amber-50 p-2">
              <p className="mb-1 text-xs font-medium text-amber-900">
                Qual peça falhou? (a impressão continua, só essa peça é perdida)
              </p>
              <div className="flex flex-col gap-1.5">
                <input
                  type="text"
                  placeholder="Descrição da peça"
                  value={pecaDescricao}
                  onChange={(e) => setPecaDescricao(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    placeholder="Gramas perdidas"
                    value={gramasPeca}
                    onChange={(e) => setGramasPeca(e.target.value)}
                    className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
                  />
                  <button
                    disabled={!pecaDescricao.trim()}
                    onClick={() => {
                      onFalhaPeca(producao.id, pecaDescricao.trim(), Number(gramasPeca) || 0);
                      setPecaDescricao("");
                      setGramasPeca("");
                      setShowFalhaPeca(false);
                    }}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    Registrar
                  </button>
                </div>
              </div>
            </div>
          )}

          {showFalhaPlaca && (
            <div className="rounded border border-red-200 bg-red-50 p-2">
              <p className="mb-1 text-xs font-medium text-red-900">
                Falha na placa inteira — não credita nada no estoque
              </p>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  placeholder="Gramas desperdiçadas"
                  value={gramasPlaca}
                  onChange={(e) => setGramasPlaca(e.target.value)}
                  className="w-32 rounded border border-gray-300 px-2 py-1 text-xs"
                />
                <button
                  onClick={() => {
                    onFalhaPlaca(producao.id, Number(gramasPlaca) || 0);
                    setGramasPlaca("");
                    setShowFalhaPlaca(false);
                  }}
                  className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  Confirmar falha
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <CarregarPlacaForm
          filaPrioridade={filaPrioridade}
          carregando={carregando}
          onIniciar={onIniciar}
        />
      )}
    </div>
  );
}

function CarregarPlacaForm({
  filaPrioridade,
  carregando,
  onIniciar,
}: {
  filaPrioridade: { placa: PlacaRow; demanda?: DemandaPlacaRow }[];
  carregando: boolean;
  onIniciar: (placaId: number, quantidadePlacas: number) => void;
}) {
  const [placaId, setPlacaId] = useState<number | "">(filaPrioridade[0]?.placa.id ?? "");
  const [quantidade, setQuantidade] = useState(1);
  const [buscaSku, setBuscaSku] = useState("");
  const [resultados, setResultados] = useState<SkuResult[]>([]);
  const [placaSelecionadaNome, setPlacaSelecionadaNome] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (buscaSku.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/skus?q=${encodeURIComponent(buscaSku.trim())}`);
        setResultados(await res.json());
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscaSku]);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">
          Buscar SKU (pra furar a fila)
        </label>
        <input
          type="text"
          placeholder="Ex: SUPORTE BMW BRANCO"
          value={buscaSku}
          onChange={(e) => setBuscaSku(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        {buscando && <p className="mt-1 text-xs text-gray-400">Buscando...</p>}
        {resultados.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 text-xs">
            {resultados.map((r) => (
              <li key={r.placa_id}>
                <button
                  onClick={() => {
                    setPlacaId(r.placa_id);
                    setPlacaSelecionadaNome(`${r.sku} → ${r.placa_nome}`);
                    setBuscaSku("");
                    setResultados([]);
                  }}
                  className="block w-full px-2 py-1 text-left hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{r.placa_nome}</span>{" "}
                  <span className="text-gray-400">
                    ({r.sku}
                    {r.variacoes > 1 ? ` +${r.variacoes - 1} variação(ões)` : ""})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-500">
          Ou escolha pela fila de prioridade
        </label>
        <select
          value={placaId}
          onChange={(e) => {
            setPlacaId(Number(e.target.value));
            setPlacaSelecionadaNome(null);
          }}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
        >
          <option value="">Selecione uma placa</option>
          {filaPrioridade.map((item) => (
            <option key={item.placa.id} value={item.placa.id}>
              {item.placa.nome} — a produzir: {item.demanda?.aProduzir ?? 0}
            </option>
          ))}
        </select>
      </div>

      {placaSelecionadaNome && (
        <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">
          Selecionado via busca: {placaSelecionadaNome}
        </p>
      )}

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={quantidade}
          onChange={(e) => setQuantidade(Math.max(1, Number(e.target.value)))}
          className="w-16 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <button
          disabled={carregando || !placaId}
          onClick={() => placaId && onIniciar(placaId, quantidade)}
          className="flex-1 rounded bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Carregar máquina
        </button>
      </div>
    </div>
  );
}
