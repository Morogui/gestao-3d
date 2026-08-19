"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PlacaRow, CORES_COM_PETG, corFilamentoDaPlaca } from "@/lib/placas";
import { MachineRow, ProducaoRow } from "@/lib/producao-types";

// Painel de chão de fábrica — pedido do Guilherme em 2026-08-19: "monte
// uma nova aba, se possível essa vai ser a página inicial da nossa
// página" inspirada em https://renancorreia.com.br/calculadora (tema
// escuro, cards com ícone), mas com os quadros das impressoras lado a
// lado (o site de referência empilha pra baixo, o nosso não). Ele pediu
// explicitamente pra manter isso separado do resto do sistema por
// enquanto ("essa nova página, deixe separado do nosso sistema por
// enquanto, vai ser a entrada do nosso sistema") — por isso essa página
// não está linkada na navegação principal ainda, e duplica localmente
// (em vez de importar) os helpers já usados em app/producao/page.tsx.
// Usa as mesmas rotas de API já existentes (nada de schema/rota nova):
// GET /api/machines, /api/producoes, /api/placas; e as mutações
// POST /api/producoes (carregar), PATCH /api/producoes/[id] (concluir/
// cancelar/falha na placa), POST /api/producoes/[id]/falha-peca,
// PATCH /api/machines/[id] (marcar em manutenção), POST
// /api/machines/[id]/manutencao (registrar retorno).

function formatHora(hora: number): string {
    const inteiro = Math.floor(hora);
    const minutos = Math.round((hora - inteiro) * 60);
    return minutos === 0 ? `${inteiro}h` : `${inteiro}h${String(minutos).padStart(2, "0")}`;
}

function formatDataHora(iso: string): string {
    return new Date(iso).toLocaleString("pt-BR");
}

type Status = "loading" | "ready" | "erro";

export default function PainelPage() {
    const [status, setStatus] = useState<Status>("loading");
    const [machines, setMachines] = useState<MachineRow[]>([]);
    const [producoes, setProducoes] = useState<ProducaoRow[]>([]);
    const [placas, setPlacas] = useState<PlacaRow[]>([]);
    const [carregando, setCarregando] = useState<Record<number, boolean>>({});
    const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
        const t = setInterval(() => setAgora(Date.now()), 30000);
        return () => clearInterval(t);
  }, []);

  async function carregar() {
        try {
                const [machinesRes, producoesRes, placasRes] = await Promise.all([
                          fetch("/api/machines").then((r) => r.json()),
                          fetch("/api/producoes").then((r) => r.json()),
                          fetch("/api/placas").then((r) => r.json()),
                        ]);
                setMachines(machinesRes);
                setProducoes(producoesRes);
                setPlacas(placasRes);
                setStatus("ready");
        } catch {
                setStatus("erro");
        }
  }

  useEffect(() => {
        carregar();
  }, []);

  async function refrescar() {
        const [machinesRes, producoesRes] = await Promise.all([
                fetch("/api/machines").then((r) => r.json()),
                fetch("/api/producoes").then((r) => r.json()),
              ]);
        setMachines(machinesRes);
        setProducoes(producoesRes);
  }

  const producaoPorMachine = useMemo(() => {
        const m = new Map<number, ProducaoRow>();
        for (const p of producoes) {
                if (p.status === "em_andamento") m.set(p.machine_id, p);
        }
        return m;
  }, [producoes]);

  const placaPorId = useMemo(() => {
        const m = new Map<number, PlacaRow>();
        for (const p of placas) m.set(p.id, p);
        return m;
  }, [placas]);

  const placasOrdenadas = useMemo(
        () =>
                [...placas]
            .filter((p) => !p.descontinuada)
            .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
        [placas]
      );

  async function comAcao(machineId: number, fn: () => Promise<void>) {
        setCarregando((prev) => ({ ...prev, [machineId]: true }));
        try {
                await fn();
                await refrescar();
        } finally {
                setCarregando((prev) => ({ ...prev, [machineId]: false }));
        }
  }

  function iniciarProducao(
        machineId: number,
        placaId: number,
        quantidadePlacas: number,
        material: "PLA" | "PETG" | null
      ) {
        return comAcao(machineId, async () => {
                await fetch("/api/producoes", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ machineId, placaId, quantidadePlacas, material }),
                });
        });
  }

  function concluir(machineId: number, producaoId: number) {
        return comAcao(machineId, async () => {
                await fetch(`/api/producoes/${producaoId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: "concluida" }),
                });
        });
  }

  function cancelar(machineId: number, producaoId: number) {
        return comAcao(machineId, async () => {
                await fetch(`/api/producoes/${producaoId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: "cancelada" }),
                });
        });
  }

  function falhaPlaca(machineId: number, producaoId: number, gramas: number) {
        return comAcao(machineId, async () => {
                await fetch(`/api/producoes/${producaoId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: "falha_placa", gramasDesperdicadas: gramas }),
                });
        });
  }

  function falhaPeca(machineId: number, producaoId: number, pecaDescricao: string, gramas: number) {
        return comAcao(machineId, async () => {
                await fetch(`/api/producoes/${producaoId}/falha-peca`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ pecaDescricao, gramas }),
                });
        });
  }

  function marcarManutencao(machineId: number) {
        return comAcao(machineId, async () => {
                await fetch(`/api/machines/${machineId}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ emManutencao: true }),
                });
        });
  }

  function registrarRetorno(machineId: number, horasParada: number, observacao: string) {
        return comAcao(machineId, async () => {
                await fetch(`/api/machines/${machineId}/manutencao`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ horasParada, observacao: observacao || null }),
                });
        });
  }

  if (status === "loading") {
        return (
                <div className="flex min-h-screen items-center justify-center bg-[#0a0a0d] text-sm text-gray-500">
                        Carregando painel...
                </div>
              );
  }
  
    if (status === "erro") {
          return (
                  <div className="flex min-h-screen items-center justify-center bg-[#0a0a0d] text-sm text-red-400">
                          Não deu pra carregar as impressoras.
                  </div>
                );
    }
  
    return (
          <div className="min-h-screen bg-[#0a0a0d] px-4 py-6 sm:px-8">
                <header className="mb-6 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/15 text-lg">
                                  🖨️
                        </div>
                        <div>
                                  <h1 className="text-lg font-semibold text-white">Painel de Impressão</h1>
                                  <p className="text-xs text-[#8b8b96]">Status ao vivo das impressoras · MOROLAR</p>
                        </div>
                </header>
          
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {machines.map((machine) => (
                      <PainelMachineCard
                                    key={machine.id}
                                    machine={machine}
                                    producao={producaoPorMachine.get(machine.id)}
                                    placaPorId={placaPorId}
                                    placasOrdenadas={placasOrdenadas}
                                    carregando={Boolean(carregando[machine.id])}
                                    agora={agora}
                                    onIniciar={iniciarProducao}
                                    onConcluir={concluir}
                                    onCancelar={cancelar}
                                    onFalhaPlaca={falhaPlaca}
                                    onFalhaPeca={falhaPeca}
                                    onMarcarManutencao={marcarManutencao}
                                    onRegistrarRetorno={registrarRetorno}
                                  />
                    ))}
                </div>
          </div>
        );
}

function StatusPill({
    children,
    tone,
}: {
    children: ReactNode;
    tone: "green" | "amber" | "gray";
}) {
    const cls =
          tone === "green"
            ? "bg-emerald-500/15 text-emerald-400"
            : tone === "amber"
            ? "bg-amber-500/15 text-amber-400"
            : "bg-white/10 text-gray-400";
    return (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${cls}`}>{children}</span>
        );
}

function PainelMachineCard({
    machine,
    producao,
    placaPorId,
    placasOrdenadas,
    carregando,
    agora,
    onIniciar,
    onConcluir,
    onCancelar,
    onFalhaPlaca,
    onFalhaPeca,
    onMarcarManutencao,
    onRegistrarRetorno,
}: {
    machine: MachineRow;
    producao: ProducaoRow | undefined;
    placaPorId: Map<number, PlacaRow>;
    placasOrdenadas: PlacaRow[];
    carregando: boolean;
    agora: number;
    onIniciar: (
          machineId: number,
          placaId: number,
          quantidadePlacas: number,
          material: "PLA" | "PETG" | null
        ) => Promise<void>;
    onConcluir: (machineId: number, producaoId: number) => Promise<void>;
    onCancelar: (machineId: number, producaoId: number) => Promise<void>;
    onFalhaPlaca: (machineId: number, producaoId: number, gramas: number) => Promise<void>;
    onFalhaPeca: (
          machineId: number,
          producaoId: number,
          pecaDescricao: string,
          gramas: number
        ) => Promise<void>;
    onMarcarManutencao: (machineId: number) => Promise<void>;
    onRegistrarRetorno: (machineId: number, horasParada: number, observacao: string) => Promise<void>;
}) {
    const [showFalhaPeca, setShowFalhaPeca] = useState(false);
    const [showFalhaPlaca, setShowFalhaPlaca] = useState(false);
    const [pecaDescricao, setPecaDescricao] = useState("");
    const [gramasPeca, setGramasPeca] = useState("");
    const [gramasPlaca, setGramasPlaca] = useState("");
  
    const placa = producao ? placaPorId.get(producao.placa_id) : undefined;
    const pecasPorPlaca = placa?.pecasPorPlaca ?? Number(producao?.pecas_por_placa ?? 0);
    const totalPecas = producao ? Number(producao.quantidade_placas) * pecasPorPlaca : 0;
  
    if (machine.em_manutencao) {
          return (
                  <ManutencaoCard
                            machine={machine}
                            carregando={carregando}
                            agora={agora}
                            onRegistrarRetorno={onRegistrarRetorno}
                          />
                );
    }
  
    return (
          <div className="flex flex-col rounded-2xl border border-[#23232b] bg-[#131318] p-4">
                <div className="mb-3 flex items-center justify-between">
                        <p className="font-semibold text-white">{machine.nome}</p>
                        <StatusPill tone={producao ? "green" : "gray"}>{producao ? "Rodando" : "Livre"}</StatusPill>
                </div>
          
            {producao ? (
                    <div className="flex flex-col gap-3">
                              <div>
                                          <p className="text-sm font-medium text-white">
                                            {producao.placa_nome}
                                            {producao.material === "PETG" && (
                                      <span className="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400">
                                                        PETG
                                      </span>
                                                        )}
                                          </p>
                                          <p className="mt-0.5 text-xs text-[#8b8b96]">
                                            {producao.quantidade_placas} placa(s) · {pecasPorPlaca} pç/placa
                                            {placa?.tempoPlacaHoras ? ` · ${formatHora(placa.tempoPlacaHoras)}/placa` : ""} ·{" "}
                                            {totalPecas} peças no total
                                          </p>
                                          <p className="mt-0.5 text-[11px] text-[#5c5c66]">
                                                        Carregada em {formatDataHora(producao.iniciado_em)}
                                          </p>
                                {Number(producao.falhas_peca_count) > 0 && (
                                    <p className="mt-1 text-xs text-amber-400">
                                      {producao.falhas_peca_count} peça(s) já perdida(s) nessa placa
                                    </p>
                                          )}
                              </div>
                    
                              <div className="flex flex-wrap gap-1.5">
                                          <button
                                                          disabled={carregando}
                                                          onClick={() => onConcluir(machine.id, producao.id)}
                                                          className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-40"
                                                        >
                                            {carregando ? "Salvando..." : "Placa impressa com sucesso"}
                                          </button>
                                          <button
                                                          disabled={carregando}
                                                          onClick={() => setShowFalhaPeca((v) => !v)}
                                                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-40"
                                                        >
                                                        Falha em peça
                                          </button>
                                          <button
                                                          disabled={carregando}
                                                          onClick={() => setShowFalhaPlaca((v) => !v)}
                                                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                                                        >
                                                        Falha na placa
                                          </button>
                                          <button
                                                          disabled={carregando}
                                                          onClick={() => onCancelar(machine.id, producao.id)}
                                                          className="rounded-lg px-2.5 py-1.5 text-xs text-[#8b8b96] hover:underline disabled:opacity-40"
                                                        >
                                                        Cancelar
                                          </button>
                              </div>
                    
                      {showFalhaPeca && (
                                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5">
                                                <p className="mb-1.5 text-[11px] text-amber-300">
                                                                Qual peça falhou? (a impressão continua, só essa peça é perdida)
                                                </p>
                                                <div className="flex flex-col gap-1.5">
                                                                <input
                                                                                    type="text"
                                                                                    placeholder="Descrição da peça"
                                                                                    value={pecaDescricao}
                                                                                    onChange={(e) => setPecaDescricao(e.target.value)}
                                                                                    className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white placeholder:text-[#5c5c66]"
                                                                                  />
                                                                <input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    placeholder="Gramas perdidas"
                                                                                    value={gramasPeca}
                                                                                    onChange={(e) => setGramasPeca(e.target.value)}
                                                                                    className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white placeholder:text-[#5c5c66]"
                                                                                  />
                                                                <button
                                                                                    disabled={carregando || !pecaDescricao.trim()}
                                                                                    onClick={async () => {
                                                                                                          await onFalhaPeca(machine.id, producao.id, pecaDescricao.trim(), Number(gramasPeca) || 0);
                                                                                                          setPecaDescricao("");
                                                                                                          setGramasPeca("");
                                                                                                          setShowFalhaPeca(false);
                                                                                      }}
                                                                                    className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-amber-400 disabled:opacity-40"
                                                                                  >
                                                                                  Registrar falha de peça
                                                                </button>
                                                </div>
                                  </div>
                              )}
                    
                      {showFalhaPlaca && (
                                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-2.5">
                                                <p className="mb-1.5 text-[11px] text-red-300">
                                                                Placa inteira perdida — quanto de filamento foi desperdiçado?
                                                </p>
                                                <div className="flex flex-col gap-1.5">
                                                                <input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    placeholder="Gramas desperdiçadas"
                                                                                    value={gramasPlaca}
                                                                                    onChange={(e) => setGramasPlaca(e.target.value)}
                                                                                    className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white placeholder:text-[#5c5c66]"
                                                                                  />
                                                                <button
                                                                                    disabled={carregando}
                                                                                    onClick={async () => {
                                                                                                          await onFalhaPlaca(machine.id, producao.id, Number(gramasPlaca) || 0);
                                                                                                          setGramasPlaca("");
                                                                                                          setShowFalhaPlaca(false);
                                                                                      }}
                                                                                    className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-red-400 disabled:opacity-40"
                                                                                  >
                                                                                  Registrar falha na placa
                                                                </button>
                                                </div>
                                  </div>
                              )}
                    </div>
                  ) : (
                    <CarregarMaquinaForm
                                machineId={machine.id}
                                carregando={carregando}
                                placasOrdenadas={placasOrdenadas}
                                onIniciar={onIniciar}
                              />
                  )}
          
                <button
                          disabled={carregando}
                          onClick={() => onMarcarManutencao(machine.id)}
                          className="mt-3 self-start text-[11px] text-[#5c5c66] hover:text-amber-400 hover:underline disabled:opacity-40"
                        >
                        Marcar em manutenção
                </button>
          </div>
        );
}

function CarregarMaquinaForm({
    machineId,
    carregando,
    placasOrdenadas,
    onIniciar,
}: {
    machineId: number;
    carregando: boolean;
    placasOrdenadas: PlacaRow[];
    onIniciar: (
          machineId: number,
          placaId: number,
          quantidadePlacas: number,
          material: "PLA" | "PETG" | null
        ) => Promise<void>;
}) {
    const [placaId, setPlacaId] = useState<number | "">("");
    const [quantidade, setQuantidade] = useState("1");
    const [material, setMaterial] = useState<"PLA" | "PETG">("PLA");
  
    const placaSelecionada = placasOrdenadas.find((p) => p.id === placaId);
    const corDaPlaca = placaSelecionada ? corFilamentoDaPlaca(placaSelecionada.nome) : null;
    const corComPetg = corDaPlaca ? CORES_COM_PETG.includes(corDaPlaca) : false;
  
    return (
          <div className="flex flex-col gap-2">
                <select
                          value={placaId}
                          onChange={(e) => setPlacaId(e.target.value ? Number(e.target.value) : "")}
                          className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white"
                        >
                        <option value="">Escolha uma placa...</option>
                  {placasOrdenadas.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.nome}
                                    </option>
                                  ))}
                </select>
          
            {placaSelecionada && (
                    <p className="text-[11px] text-[#8b8b96]">
                      {placaSelecionada.pecasPorPlaca} pç/placa
                      {placaSelecionada.tempoPlacaHoras
                                    ? ` · Tempo médio de impressão: ${formatHora(placaSelecionada.tempoPlacaHoras)}`
                                    : ""}
                    </p>
                )}
          
            {corComPetg && (
                    <div className="flex gap-1.5">
                      {(["PLA", "PETG"] as const).map((m) => (
                                  <button
                                                  key={m}
                                                  type="button"
                                                  onClick={() => setMaterial(m)}
                                                  className={
                                                                    material === m
                                                                      ? "rounded-lg bg-orange-500 px-2.5 py-1 text-xs font-medium text-black"
                                                                      : "rounded-lg border border-[#2c2c36] px-2.5 py-1 text-xs font-medium text-[#8b8b96]"
                                                  }
                                                >
                                    {m}
                                  </button>
                                ))}
                    </div>
                )}
          
                <input
                          type="number"
                          min={1}
                          value={quantidade}
                          onChange={(e) => setQuantidade(e.target.value)}
                          className="w-20 rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white"
                        />
          
                <button
                          disabled={carregando || !placaId || Number(quantidade) < 1}
                          onClick={async () => {
                                      if (!placaId) return;
                                      await onIniciar(machineId, Number(placaId), Number(quantidade) || 1, corComPetg ? material : null);
                                      setPlacaId("");
                                      setQuantidade("1");
                          }}
                          className="rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-orange-400 disabled:opacity-40"
                        >
                  {carregando ? "Carregando..." : "Carregar máquina"}
                </button>
          </div>
        );
}

function ManutencaoCard({
    machine,
    carregando,
    agora,
    onRegistrarRetorno,
}: {
    machine: MachineRow;
    carregando: boolean;
    agora: number;
    onRegistrarRetorno: (machineId: number, horasParada: number, observacao: string) => Promise<void>;
}) {
    const horasDecorridas = machine.manutencao_inicio
          ? (agora - new Date(machine.manutencao_inicio).getTime()) / 3600000
          : 0;
    const [horas, setHoras] = useState(() => horasDecorridas.toFixed(1));
    const [observacao, setObservacao] = useState("");
  
    return (
          <div className="flex flex-col rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
                <div className="mb-3 flex items-center justify-between">
                        <p className="font-semibold text-white">{machine.nome}</p>
                        <StatusPill tone="amber">Em manutenção</StatusPill>
                </div>
                <p className="mb-2 text-xs text-[#8b8b96]">
                        Parada desde {machine.manutencao_inicio ? formatDataHora(machine.manutencao_inicio) : "—"}
                  {machine.manutencao_inicio ? ` (${horasDecorridas.toFixed(1)}h atrás)` : ""}
                </p>
                  <div className="flex flex-col gap-1.5">
                          <label className="text-[11px] text-[#8b8b96]">Horas paradas</label>
                          <input
                                      type="number"
                                      min={0}
                                      step="0.1"
                                      value={horas}
                                      onChange={(e) => setHoras(e.target.value)}
                                      className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white"
                                    />
                          <input
                                      type="text"
                                      placeholder="Observação (opcional)"
                                      value={observacao}
                                      onChange={(e) => setObservacao(e.target.value)}
                                      className="rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2 py-1.5 text-xs text-white placeholder:text-[#5c5c66]"
                                    />
                          <button
                                      disabled={carregando}
                                      onClick={() => onRegistrarRetorno(machine.id, Number(horas) || 0, observacao.trim())}
                                      className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-amber-400 disabled:opacity-40"
                                    >
                            {carregando ? "Salvando..." : "Registrar retorno"}
                          </button>
                  </div>
          </div>
        );
}
