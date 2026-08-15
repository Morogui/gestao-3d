"use client";

import { createElement, Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PlacaRow,
  estoqueVendavel,
  CORES_FILAMENTO,
  CorFilamento,
  corFilamentoDaPlaca,
  corPetgDe,
  CORES_COM_PETG,
} from "@/lib/placas";
import { horaAtualSP, horasAteProximaAbertura } from "@/lib/date";
import {
  MachineRow,
  ProducaoRow,
  DemandaResult,
  DemandaPlacaRow,
  ConsumoResult,
  EstoqueFilamentoRow,
  formatGramasEmKg,
} from "@/lib/producao-types";

// Dias de estoque restante no ritmo de venda atual (estoque ÷ venda
// média diária). É a métrica usada pra ordenar a fila de prioridade a
// pedido do Guilherme: "priorizar quem mais vende e não dar quebra de
// estoque" — um SKU que vende muito naturalmente tem menos dias de
// estoque pra um mesmo volume parado, então essa conta já favorece
// bestsellers automaticamente, sem precisar de um critério separado de
// volume. Infinity quando não há venda média (não deveria entrar na fila
// de prioridade de qualquer forma, já que aProduzir só é > 0 quando há
// mediaSemanal > 0).
// Formata uma duracao em milissegundos como "2h 15min" -- usado pra
// mostrar quanto tempo uma producao levou de fato (do carregamento ate
// a conclusao) no popup de resumo pos-producao. Pedido do Guilherme em
// 2026-08-12: ele valida os numeros do popup contra o fatiador, e
// precisa ver o tempo real pra comparar.
function formatDuracaoMs(ms: number): string {
    const totalMin = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}min`;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function diasDeEstoque(estoque: number, mediaSemanal: number): number {
  if (mediaSemanal <= 0) return Infinity;
  return (estoque / mediaSemanal) * 7;
}

// Janela usada pro critério "vendeu recentemente?" da fila de prioridade —
// pedido do Guilherme em 2026-07-24: "produtos sem vendas no intervalo de
// 2 semanas devem entrar como última prioridade, mesmo sem estoque; entram
// pra prioridade quando sair venda de novo". Um produto pode ter aProduzir
// > 0 só porque vendeu algo entre 15-30 dias atrás (dentro da janela de 30
// dias usada pra calcular a meta) — sem isso, esse tipo de produto competia
// de igual pra igual com quem vende toda semana, só por estar com estoque
// zerado.
const DUAS_SEMANAS_MS = 14 * 24 * 60 * 60 * 1000;
function vendeuUltimasDuasSemanas(demanda: DemandaPlacaRow | undefined): boolean {
  if (!demanda?.ultimaVendaEm) return false;
  return Date.now() - new Date(demanda.ultimaVendaEm).getTime() <= DUAS_SEMANAS_MS;
}

// Quantas placas carregar de uma vez pra cobrir o horário sem ninguém pra
// trocar (janela de operação aprendida — ver /api/producao/janela). Sempre
// ao menos 1 placa.
function qtdParaVirarNoite(tempoPlacaHoras: number, aberturaHora: number): number {
  if (!tempoPlacaHoras || tempoPlacaHoras <= 0) return 1;
  return Math.max(1, Math.ceil(horasAteProximaAbertura(aberturaHora) / tempoPlacaHoras));
}

// Formata uma hora fracionária (ex: 9.5) como "9h30".
function formatHora(hora: number): string {
  const inteiro = Math.floor(hora);
  const minutos = Math.round((hora - inteiro) * 60);
  return minutos === 0 ? `${inteiro}h` : `${inteiro}h${String(minutos).padStart(2, "0")}`;
}

interface Janela {
  aberturaHora: number;
  fechamentoHora: number;
  amostras: number;
  aprendido: boolean;
}

// Item da fila de prioridade — além da placa/demanda "crua", já traz o
// quanto dessa placa está sendo produzido AGORA em alguma impressora
// (emProducao), o estoque projetado (estoque atual + emProducao) e o
// "a produzir" já descontando isso (aProduzirEfetivo). Existe pra
// resolver um bug real: sem isso, quando uma impressora começa a
// produzir uma placa, as OUTRAS impressoras livres continuavam vendo
// a mesma placa como prioridade máxima (porque o estoque no banco só
// aumenta quando a produção é CONCLUÍDA) e acabavam sendo carregadas
// com o mesmo produto — 3 máquinas rodando "Suporte Secador de Cabelo
// (Branco)" ao mesmo tempo, por exemplo. Ver pecasEmProducaoPorPlaca.
interface FilaPrioridadeItem {
  placa: PlacaRow;
  demanda?: DemandaPlacaRow;
  emProducao: number;
  estoqueProjetado: number;
  aProduzirEfetivo: number;
  // Peças que faltam pra cobrir pedidos JÁ VENDIDOS e ainda não
  // despachados (pecasPendentesDespacho - estoqueProjetado, nunca
  // negativo) — backlog real, prioridade acima de tudo. Ver critério
  // nº-1 em filaPrioridade abaixo.
  faltaDespacho: number;
  // Peças que faltam produzir pra cobrir os ENVIOS DO FULL planejados e
  // ainda pendentes de confirmação (ver aba Full — "Envios planejados").
  // Pedido do Guilherme em 2026-07-25: "gera uma ordem de produção
  // extraordinária de prioridade para produzir o full, depois seguimos
  // todas as ordens combinada" — por isso esse é o critério nº-2, ANTES
  // até do backlog de despacho (nº-1). Confirmar o envio na aba Full
  // zera isso na hora (tira da linha de frente).
  faltaEnvioFull: number;
}

const JANELA_PADRAO: Janela = {
  aberturaHora: 9,
  fechamentoHora: 23,
  amostras: 0,
  aprendido: false,
};

// Relógio de São Paulo ao vivo (atualiza a cada segundo) + status
// Aberto/Fechado com base na janela de operação aprendida — pedido do
// Guilherme depois de mexer no sistema às 23h57 sem ter como saber, só
// olhando a tela, que já tinha passado do horário de troca.
function RelogioOperacao({ janela }: { janela: Janela }) {
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const sp = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const hh = String(sp.getUTCHours()).padStart(2, "0");
  const mm = String(sp.getUTCMinutes()).padStart(2, "0");
  const ss = String(sp.getUTCSeconds()).padStart(2, "0");
  const horaAtual = sp.getUTCHours() + sp.getUTCMinutes() / 60;
  const aberto = horaAtual >= janela.aberturaHora && horaAtual < janela.fechamentoHora;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
      <span className="font-mono text-xl font-semibold tabular-nums text-gray-900">
        {hh}:{mm}:{ss}
      </span>
      <span
        className={
          "rounded-full px-2 py-0.5 text-xs font-medium " +
          (aberto ? "bg-green-100 text-green-700" : "bg-gray-800 text-white")
        }
      >
        {aberto ? "Aberto — pode trocar placa" : "Fechado — máquinas rodando sozinhas"}
      </span>
      <span className="text-xs text-gray-400">
        Janela {janela.aprendido ? "aprendida" : "padrão"}: {formatHora(janela.aberturaHora)} –{" "}
        {formatHora(janela.fechamentoHora)}
        {janela.aprendido && ` (a partir de ${janela.amostras} carregamentos)`}
      </span>
    </div>
  );
}

// Formata gramas como "X,X kg" (ou "Xg" pra valores pequenos) — os
// totais acumulados de filamento tendem a passar de 1kg rapidinho.
function formatGramas(gramas: number): string {
  if (gramas >= 1000) {
    return `${(gramas / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
  }
  return `${gramas.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} g`;
}

type Status = "loading" | "ready" | "erro" | "desconectado";

interface SkuResult {
  sku: string;
  placa_id: number;
  pecas_por_unidade: string;
  placa_nome: string;
  placa_numero: number;
  variacoes: number;
}

// Envio planejado do Full ainda pendente (ver aba Full — "Envios
// planejados" e app/api/full/envios/route.ts). faltantePlaca já vem
// calculado do servidor: quanto falta produzir pra cobrir TODOS os
// envios pendentes dessa placa, descontando estoque + em produção.
interface EnvioFullPendente {
  id: number;
  placaId: number;
  status: "pendente" | "confirmado" | "cancelado";
  faltantePlaca: number;
}

export default function ProducaoPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [placas, setPlacas] = useState<PlacaRow[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [producoes, setProducoes] = useState<ProducaoRow[]>([]);
  const [demanda, setDemanda] = useState<DemandaResult | null>(null);
  const [consumo, setConsumo] = useState<ConsumoResult | null>(null);
  const [janela, setJanela] = useState<Janela>(JANELA_PADRAO);
  // Estoque de filamento por cor (gramas) — pedido do Guilherme em
  // 2026-07-25: cor deixada em 0 bloqueia automaticamente a fila de
  // prioridade pras placas daquela cor (ver corFilamentoDaPlaca em
  // lib/placas.ts e o filtro de filaPrioridade abaixo).
  const [filamento, setFilamento] = useState<EstoqueFilamentoRow | null>(null);
  const [resumoProducao, setResumoProducao] = useState<{ producaoId: number; placaNome: string; papel: string | null; pecasProduzidas: number; falhas: number; quantidadePlacas: number; pecasPorPlaca: number; extra: { placaNome: string; pecas: number } | null; gramas: number; cor: string | null; tempoMs: number } | null>(null);
    const [editandoPeso, setEditandoPeso] = useState(false);
    const [valorPesoEditado, setValorPesoEditado] = useState("");
    const [salvandoCorrecao, setSalvandoCorrecao] = useState(false);
        const [erroCorrecao, setErroCorrecao] = useState<string | null>(null);
      const [editandoTempo, setEditandoTempo] = useState(false);
      const [horasEditadas, setHorasEditadas] = useState("");
      const [minutosEditados, setMinutosEditados] = useState("");
      const [salvandoTempo, setSalvandoTempo] = useState(false);
      const [erroTempo, setErroTempo] = useState<string | null>(null);
  const [editandoPecas, setEditandoPecas] = useState(false);
  const [valorPecasEditado, setValorPecasEditado] = useState("");
  const [salvandoPecas, setSalvandoPecas] = useState(false);
  const [erroPecas, setErroPecas] = useState<string | null>(null);
  // Envios planejados do Full ainda pendentes — pedido do Guilherme em
  // 2026-07-25: alimenta o critério nº-2 da fila de prioridade (ver
  // filaPrioridade abaixo).
  const [enviosFull, setEnviosFull] = useState<EnvioFullPendente[]>([]);
  const [carregando, setCarregando] = useState<Record<number, boolean>>({});
  // Só pra fazer a fila/sugestões reagirem sozinhas quando o relógio
  // cruza o horário de fechamento, sem precisar de uma ação manual pra
  // "acordar" a tela — atualiza a cada minuto.
  const [horaTick, setHoraTick] = useState(() => horaAtualSP());
  // Pedido do Guilherme em 2026-07-31: "na parte de histórico recente,
  // colocar uma observação em cada placa concluída, quando clicado mostra
  // número de peças impressas e mostra a movimentação entrando em
  // estoque" — clicar numa linha da tabela expande um detalhe (sem
  // precisar de rota nova: os números já existem no cliente, cruzando
  // ProducaoRow com o cadastro de placas — ver detalheProducao() abaixo).
  const [producaoExpandidaId, setProducaoExpandidaId] = useState<number | null>(null);
  // Cadastro/renomeação de impressora self-service — pedido do Guilherme
  // em 2026-08-04: "estou comprando mais [impressoras] e se ficar pedindo
  // pra você colocar toda hora vou perder tempo". Ver adicionarMaquina/
  // renomearMaquina abaixo e POST/PATCH em /api/machines.
  const [mostrarNovaMaquina, setMostrarNovaMaquina] = useState(false);
  const [nomeNovaMaquina, setNomeNovaMaquina] = useState("");
  const [salvandoMaquina, setSalvandoMaquina] = useState(false);

  // Refresh "rápido": tudo que NÃO depende de buscar pedidos na ML/Shopee
  // (placas, máquinas, produções, consumo, janela) — normalmente volta em
  // menos de 1s. Separado do refresh de demanda de propósito: depois de
  // uma ação (carregar máquina, concluir, falha etc.) só isso aqui
  // precisa terminar pra tela e botão reagirem; não faz sentido travar o
  // clique do usuário esperando a ML/Shopee responderem de novo.
  async function carregarRapido() {
    const [placasRes, machinesRes, producoesRes, consumoRes, janelaRes, filamentoRes, enviosFullRes] =
      await Promise.all([
        fetch("/api/placas").then((r) => r.json()),
        fetch("/api/machines").then((r) => r.json()),
        fetch("/api/producoes").then((r) => r.json()),
        fetch("/api/producao/consumo").then((r) => r.json()),
        fetch("/api/producao/janela").then((r) => r.json()),
        fetch("/api/producao/filamento").then((r) => r.json()),
        fetch("/api/full/envios").then((r) => r.json()),
      ]);
    setPlacas(placasRes);
    setMachines(machinesRes);
    setProducoes(producoesRes);
    setConsumo(consumoRes);
    setJanela(janelaRes ?? JANELA_PADRAO);
    setFilamento(filamentoRes);
    setEnviosFull(enviosFullRes);
  }

  // Ver estado mostrarNovaMaquina/nomeNovaMaquina acima — botão "+ Nova
  // impressora" na seção Impressoras.
  async function adicionarMaquina() {
    const nome = nomeNovaMaquina.trim();
    if (!nome) return;
    setSalvandoMaquina(true);
    try {
      await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome }),
      });
      setNomeNovaMaquina("");
      setMostrarNovaMaquina(false);
      await carregarRapido();
    } finally {
      setSalvandoMaquina(false);
    }
  }

  async function renomearMaquina(id: number, nome: string) {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) return;
    await fetch(`/api/machines/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: nomeLimpo }),
    });
    await carregarRapido();
  }

  // Refresh "lento": busca pedidos de 30 dias na ML + Shopee (com
  // shipment por pedido na ML) pra recalcular demanda/fila de prioridade
  // — é o que demora (historicamente 10-15s+ dependendo do volume de
  // pedidos). Pedido pelo Guilherme em 2026-07-23 ("sistema tá lento e
  // adicionar estoque não tá indo"): antes disso bloqueava TODA ação
  // (carregar máquina, concluir etc.) até terminar, sem nenhum feedback
  // visual — parecia que o clique não tinha feito nada. Agora essa busca
  // roda em paralelo/background depois de uma ação, sem travar o botão.
  async function carregarDemanda(): Promise<boolean> {
    const demandaRes = await fetch("/api/producao/demanda").then((r) => r.json());
    if (!demandaRes.connected) {
      setStatus("desconectado");
      return false;
    }
    if (demandaRes.error) {
      setStatus("erro");
      return false;
    }
    setDemanda(demandaRes);
    return true;
  }

  // Carga inicial da página — precisa das duas (rápida + demanda) antes
  // de decidir se mostra a tela (conectado/erro/pronta).
  async function carregarTudo() {
    const [, demandaOk] = await Promise.all([carregarRapido(), carregarDemanda()]);
    if (demandaOk) setStatus("ready");
  }

  // Marca um item do aviso de "venda não identificada" pra parar de
  // aparecer ali — usado pra produtos que a Multiplique/Morolar não
  // vende mais e nunca vão ganhar uma placa própria no catálogo (ver
  // app/api/producao/ignorar-item). Some da lista na hora (otimista,
  // sem esperar a ML/Shopee responderem de novo — isso pode levar
  // 10s+) e ainda assim dispara o refresh de demanda completo em
  // segundo plano pra confirmar/recalcular os totais direito.
  async function ignorarItem(titulo: string, sku: string) {
    setDemanda((prev) => {
      if (!prev) return prev;
      const remove = (n: typeof prev.naoIdentificadoSemana) =>
        n && {
          ...n,
          amostras: n.amostras.filter(
            (a) => !(a.titulo === titulo && a.sku === sku)
          ),
        };
      return {
        ...prev,
        naoIdentificado: remove(prev.naoIdentificado),
        naoIdentificadoSemana: remove(prev.naoIdentificadoSemana),
      };
    });
    await fetch("/api/producao/ignorar-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, sku }),
    });
    carregarDemanda();
  }

  async function salvarPesoPlaca(placaId: number, pesoPlacaGramas: number | null) {
    await fetch(`/api/placas/${placaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pesoPlacaGramas }),
    });
    await carregarRapido();
  }

  async function salvarImpressoManualKg(kg: number) {
    await fetch("/api/producao/consumo", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gramasImpressasManual: Math.max(0, kg) * 1000 }),
    });
    await carregarRapido();
  }

  // Registra uma perda AVULSA de filamento (fora de uma produção
  // rastreada) — pedido do Guilherme em 2026-07-26: "coloque um campo
  // onde eu consiga adicionar perda a parte" + "precisa alimentar qual o
  // filamento que teve perda, cor do filamento". Voltou pra Produção em
  // 2026-07-29 (pedido: "Registrar perda, deve estar na aba de
  // producao") depois de ter passado brevemente pela aba Estoque — faz
  // mais sentido registrar aqui porque a perda normalmente é percebida
  // durante o trabalho na máquina, não na gestão de estoque. Desconta na
  // hora do estoque daquela cor e soma no card "Total já desperdiçado"
  // acima. Depois de salvar, recarrega filamento + consumo pra refletir
  // os dois na tela.
  async function registrarPerdaFilamento(
    cor: CorFilamento,
    gramas: number,
    motivo: string
  ): Promise<string | null> {
    const res = await fetch("/api/producao/perda-filamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cor, gramas, motivo: motivo || undefined }),
    });
    const data = await res.json();
    if (!res.ok) {
      return data.error ?? "Erro ao registrar perda.";
    }
    await carregarRapido();
    return null;
  }

  useEffect(() => {
    carregarTudo();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setHoraTick(horaAtualSP()), 60000);
    return () => clearInterval(t);
  }, []);

  // "Perto do fechamento" = já fechado (fora da janela aprendida) OU
  // dentro das últimas ~3h antes de fechar. Nesse período ninguém troca
  // placa até a próxima abertura, então o que for carregado agora precisa
  // durar até lá.
  const pertoDoFechamento =
    horaTick < janela.aberturaHora ||
    horaTick >= janela.fechamentoHora ||
    horaTick >= janela.fechamentoHora - 3;

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

  // Detalhe expandido de uma linha do Histórico recente — pedido do
  // Guilherme em 2026-07-31: "colocar uma observação em cada placa
  // concluída, quando clicado mostra número de peças impressas e mostra a
  // movimentação entrando em estoque". Não precisa de rota nova: os
  // números batem exatamente com o que o PATCH /api/producoes/[id]
  // credita na hora da conclusão (ver pecasProduzidas/pecasExtraProduzidas
  // lá) — só que recalculados aqui no cliente cruzando o snapshot salvo em
  // ProducaoRow (quantidade_placas, pecas_por_placa, falhas_peca_count)
  // com o cadastro atual da placa (saída extra, pra placas "Mista").
  function detalheProducao(p: ProducaoRow) {
    const quantidadePlacas = Number(p.quantidade_placas);
    const pecasPorPlaca = Number(p.pecas_por_placa);
    const falhas = Number(p.falhas_peca_count ?? 0);
    const pecasProduzidas = Math.max(0, quantidadePlacas * pecasPorPlaca - falhas);
    const placaCadastro = placaPorId.get(p.placa_id);
    const extra =
      placaCadastro?.saidaExtraPlacaId && placaCadastro.saidaExtraPecas
        ? {
            placaNome: placaPorId.get(placaCadastro.saidaExtraPlacaId)?.nome ?? "placa vinculada",
            pecas: quantidadePlacas * placaCadastro.saidaExtraPecas,
          }
        : null;
    return { quantidadePlacas, pecasPorPlaca, falhas, pecasProduzidas, extra };
  }

  // Quantas peças de cada placa já estão "a caminho" — sendo produzidas
  // AGORA em alguma impressora rodando. Somado por placa porque mais de
  // uma máquina pode estar rodando a mesma placa ao mesmo tempo. Isso é
  // o que faltava pra evitar carregar duas impressoras com o mesmo
  // produto: antes, o estoque só contava o que já tinha sido CONCLUÍDO,
  // então uma impressora livre não "via" que outra já estava resolvendo
  // aquela demanda.
  const pecasEmProducaoPorPlaca = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of producoesEmAndamento) {
      const pecas = Number(p.quantidade_placas) * Number(p.pecas_por_placa);
      map.set(p.placa_id, (map.get(p.placa_id) ?? 0) + pecas);
    }
    return map;
  }, [producoesEmAndamento]);

  const totalFullSemana = (demanda?.demanda ?? []).reduce(
    (soma, d) => soma + d.qtyVendidaFull,
    0
  );

  // Envios do Full ainda pendentes, por placa — pedido do Guilherme em
  // 2026-07-25 (aba Full, seção "Envios planejados"): faltantePlaca já
  // vem calculado do servidor (ver app/api/full/envios/route.ts), então
  // aqui só precisamos do mapa placaId -> faltantePlaca pra alimentar o
  // critério nº-2 abaixo. Confirmar o envio na aba Full remove o registro
  // da lista de "pendente" e some daqui automaticamente no próximo
  // refresh.
  const enviosFullPorPlaca = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of enviosFull) {
      if (e.status !== "pendente") continue;
      map.set(e.placaId, Math.max(map.get(e.placaId) ?? 0, e.faltantePlaca));
    }
    return map;
  }, [enviosFull]);

  // Fila de prioridade: placas com algo a produzir.
  //
  // Critério nº-2, ANTES de TUDO (inclusive antes do backlog de despacho
  // nº-1 abaixo): envio do Full planejado e ainda sem estoque suficiente
  // — faltaEnvioFull, decrescente. Pedido do Guilherme em 2026-07-25: "se
  // não tiver essa quantidade, gera uma ordem de produção extraordinária
  // de prioridade para produzir o full, depois seguimos todas as ordens
  // combinada" — ou seja, essa é a ÚNICA coisa que fura até o backlog de
  // despacho, e só enquanto o envio não for confirmado (ou produzido o
  // suficiente) na aba Full. Ver EnviosPlanejados em app/full/page.tsx.
  //
  // Critério nº-1, ANTES de TUDO o resto (inclusive antes do nº0 abaixo): backlog
  // real de despacho — faltaDespacho = pecasPendentesDespacho (pedidos já
  // PAGOS e ainda não despachados) menos o estoque projetado, decrescente.
  // Pedido do Guilherme em 2026-07-25: "o suporte de mangueira é uma venda
  // que precisamos despachar e não tem estoque suficiente, então ela
  // deveria tomar a frente". Achado real: "Suporte Mangueira (Prata)"
  // tinha 10 pedidos pagos, só 6 já despachados (delivered/shipped) e
  // apenas 1 peça em estoque — isso é MAIS urgente que o critério nº1
  // (dias de estoque médio) porque é um pedido concreto esperando, não
  // uma projeção de ritmo de venda. Ver pecasPendentesDespacho em
  // lib/demanda.ts.
  //
  // Critério nº0, antes do nº1 abaixo (mas depois do nº-1 acima): vendeu
  // nas últimas 2 semanas? Pedido do Guilherme em 2026-07-24: "produtos
  // sem vendas no intervalo de 2 semanas devem entrar como última
  // prioridade, mesmo sem estoque; entram pra prioridade quando sair
  // venda [de novo]". Sem esse critério, um produto que vendeu 1x há 20
  // dias (e nada desde então) aparecia com "0 dias de estoque" (máxima
  // urgência) só por estar zerado — competindo de igual pra igual com
  // quem vende toda semana. Continua aparecendo na fila (informativo,
  // não desaparece), só cai pro fim — ver vendeuUltimasDuasSemanas() acima.
  //
  // Critério nº1, SEMPRE, em qualquer horário, sem exceção (entre itens
  // que já passaram pelo nº0 acima): produto com
  // venda real e sem estoque é nível 1 de prioridade — "dias de estoque
  // restante" (estoque ÷ venda média diária), crescente. Confirmado pelo
  // Guilherme em 2026-07-23 e reafirmado em 2026-07-24 ("todo produto
  // vendido tem que ter estoque; se não tiver, prioridade máxima") — isso
  // NUNCA muda, nem de dia nem de noite. A meta usada por trás dessa conta
  // (recomendadoEstoque, em lib/demanda.ts) é 1 mês de venda × 1.3, somando
  // venda normal E Full — regra do Guilherme em 2026-07-24 ("o estoque que
  // precisamos criar é de 1 mês de venda do produto... x1.3").
  //
  // Critério nº2 (desempate, SÓ À NOITE/perto do fechamento — restrição
  // operacional REAL, não preferência): viabilidade de virar a madrugada
  // sozinha — qtdParaVirarNoite() crescente (quem precisa de menos
  // recargas pra cobrir até a reabertura entra na frente). Adicionado em
  // 2026-07-24 depois do Guilherme mostrar o "6X3 18 FATIAS" (placa de
  // ~1h13, precisaria de 8 recargas) sugerido como nº1 às 00h30 — ninguém
  // troca placa 8x de madrugada, isso é uma restrição física real, não
  // uma preferência. Por isso entra ANTES do volume de venda abaixo — de
  // nada adianta priorizar o maior vendedor se a placa dele vai ficar
  // parada a noite toda depois de terminar sozinha.
  //
  // Critério nº3 (desempate, SEMPRE, em qualquer horário): volume de
  // venda (mediaSemanal, decrescente) — entre itens igualmente urgentes
  // (e igualmente viáveis pra madrugada, à noite), quem vende mais entra
  // na frente. ESSENCIAL: isso vem ANTES do critério de trocabilidade
  // diurna abaixo. Bug corrigido em 2026-07-24 (v92 tinha isso invertido):
  // o Guilherme viu "Porta Copo Taça do Mundo" e "Troféu Copa do Mundo"
  // (tempoPlacaHoras = 1h, quase sem venda real) na frente de "Suporte
  // para Garrafa Coração" (venda real, mas placa de ~1h55) só por causa
  // do tempo de placa curto — "a gente precisa priorizar produtos com
  // venda e produtos que mais vendem". Isso é EXATAMENTE o erro que já
  // tínhamos corrigido antes (v85→v86: "volume de venda sempre desempata,
  // sem exceção") — só que dessa vez reintroduzido pro período diurno.
  // Volume de venda vem antes de qualquer critério de tempo de placa,
  // sempre, exceto a viabilidade noturna acima (que é restrição física,
  // não preferência).
  //
  // Critério nº4 (desempate diurno residual — SÓ entre placas de volume
  // de venda EMPATADO, em horário comercial): trocabilidade — tempo de
  // placa crescente (placas curtas, de 1 a 4h, que dá pra trocar e
  // reabastecer ao longo do dia, entram na frente). Pedido do Guilherme
  // em 2026-07-24: "de manhã até as vinte horas, priorizar placas que dê
  // pra trocar" — mas só como desempate residual, nunca acima do volume
  // de venda (ver nº3).
  //
  // Critério nº5 (desempate final residual, só entre placas de volume E
  // trocabilidade idênticos): tempo de placa decrescente. A coluna "Qtd
  // p/ virar a noite" continua mostrando esse dado por linha pra decisão
  // manual. Ver diasDeEstoque() e qtdParaVirarNoite() acima.
  //
  // Nota: placas descontinuadas nunca entram aqui — aProduzir já vem
  // zerado de calcularDemandaSemanal (lib/demanda.ts) pra elas, mesmo que
  // o casamento de texto detecte alguma venda residual.
  const filaPrioridade: FilaPrioridadeItem[] = useMemo(() => {
    const itens = placas
      .map((placa) => {
        const demanda = demandaPorPlaca.get(placa.id);
        const emProducao = pecasEmProducaoPorPlaca.get(placa.id) ?? 0;
        const estoqueProjetado = placa.estoque + emProducao;
        const aProduzirEfetivo = Math.max(0, (demanda?.aProduzir ?? 0) - emProducao);
        const faltaDespacho = Math.max(
          0,
          (demanda?.pecasPendentesDespacho ?? 0) - estoqueProjetado
        );
        const faltaEnvioFull = enviosFullPorPlaca.get(placa.id) ?? 0;
        return {
          placa,
          demanda,
          emProducao,
          estoqueProjetado,
          aProduzirEfetivo,
          faltaDespacho,
          faltaEnvioFull,
        };
      })
      // Usa aProduzirEfetivo (já descontando o que está sendo produzido
      // agora) em vez do aProduzir "cru" — senão uma placa que já tem
      // uma impressora rodando pra ela continua aparecendo com a mesma
      // urgência pras outras impressoras livres. Mantém também quem tem
      // faltaDespacho > 0 mesmo no raro caso de aProduzirEfetivo cair a
      // zero — um backlog real nunca deve sumir da fila silenciosamente.
      //
      // Filtro extra de filamento — pedido do Guilherme em 2026-07-25: "o
      // que eu deixar zerado não precisa subir produto para a produção".
      // Detecta a cor do filamento pelo nome da placa
      // (corFilamentoDaPlaca, mesma convenção "Nome (Cor)" do catálogo) e
      // exclui da fila qualquer placa cuja cor esteja com 0g cadastrado —
      // sem filamento daquela cor não tem como produzir de qualquer jeito,
      // então não faz sentido sugerir (nem como backlog de despacho).
      // Placas sem estoque de filamento carregado ainda (filamento ===
      // null, API não respondeu) ou cor não controlada (corFilamentoDaPlaca
      // retorna null — cinza/laranja) nunca são bloqueadas.
      //
      // EXCEÇÃO 1: envio do Full pendente (faltaEnvioFull > 0) nunca é
      // bloqueado por esse filtro. Achado real em 2026-07-27: "Suporte
      // Secador de Cabelo (Preto)" tinha envio Full com faltam 23 (aba
      // Full) mas sumia da fila de prioridade porque o filamento preto
      // estava com 0g cadastrado — o filtro de filamento (critério
      // operacional, "não produz sem material") estava silenciosamente
      // vencendo o critério nº-2 (envio Full, que é pra ser ACIMA DE TUDO).
      // O propósito do envio Full aparecer com prioridade máxima é
      // justamente alertar que precisa resolver o filamento (comprar/repor)
      // pra conseguir produzir — escondê-lo por falta de filamento é o
      // oposto do que o Guilherme pediu.
      //
      // EXCEÇÃO 2: estoque zerado + venda real recente também nunca é
      // bloqueado. Achado real em 2026-07-28: "Suporte Mangueira (Preto)"
      // vendeu na ML, estoque zerado, mas sumiu da fila porque o filamento
      // preto estava em 0g — bateu de frente com o critério nº1 ("todo
      // produto vendido tem que ter estoque; se não tiver, prioridade
      // máxima... isso NUNCA muda", 2026-07-23/24). O filtro de filamento
      // é pra suprimir SUGESTÃO de produção antecipada sem material, não
      // pra esconder um estoque zerado com venda de verdade — isso tem
      // que aparecer sempre, mesmo sem filamento, pra alertar que precisa
      // repor o material urgente.
      // EXCEÇÃO 3 (2026-07-31): placa "Mista" (papel='corpo' com
      // saidaExtraPlacaId apontando pro Gancho Compartilhado — ex: Suporte
      // BMW/Universal - Mista) nunca é bloqueada por aProduzirEfetivo=0.
      // Achado real: "SUPORTE BMW BRANCO/PRETO" vende quase 100% com SKU
      // exato cadastrado em sku_placa, que aponta direto pra Corpos +
      // Gancho Compartilhado — então a Mista nunca acumula demanda própria
      // (nem por SKU exato, que não aponta pra ela, nem por texto, que fica
      // sem sobra) e sumia da fila inteira, mesmo sendo uma opção de
      // impressão válida (o Guilherme pediu explicitamente: "na hora da
      // produção deve se mostrar as placas mista e a placa gancho, o bmw
      // está assim..." reclamando que só aparecia Corpos). A Mista é uma
      // ESCOLHA de produção (imprimir corpo+gancho juntos em vez de só
      // corpo), não uma necessidade própria — por isso fica sempre
      // disponível pro operador escolher manualmente, mesmo com "a
      // produzir: 0" na própria linha (a necessidade real já aparece nas
      // linhas de Corpos e Gancho Compartilhado).
      .filter(
        (item) =>
          item.aProduzirEfetivo > 0 ||
          item.faltaDespacho > 0 ||
          item.faltaEnvioFull > 0 ||
          Boolean(item.placa.saidaExtraPlacaId)
      )
      .filter((item) => {
        if (item.faltaEnvioFull > 0) return true;
        if (item.estoqueProjetado <= 0 && vendeuUltimasDuasSemanas(item.demanda)) return true;
        // Mesma EXCEÇÃO 3 acima — a Mista é uma escolha de produção, não
        // uma sugestão automática por demanda/estoque, então também não
        // é bloqueada pelo filtro de filamento zerado.
        if (item.placa.saidaExtraPlacaId) return true;
        if (!filamento) return true;
        const cor = corFilamentoDaPlaca(item.placa.nome);
        if (!cor) return true;
        // 2026-07-29: cor pode ter estoque em duas variantes (PLA e
        // PETG, pras 3 cores em CORES_COM_PETG) — não bloqueia a fila se
        // QUALQUER uma das duas tiver saldo, já que o operador escolhe o
        // material na hora de carregar a máquina.
        const estoquePla = filamento[cor] ?? 0;
        const estoquePetg = CORES_COM_PETG.includes(cor) ? filamento[corPetgDe(cor)] ?? 0 : 0;
        return estoquePla + estoquePetg > 0;
      });

    const porDiasDeEstoque = (a: FilaPrioridadeItem, b: FilaPrioridadeItem) =>
      diasDeEstoque(a.estoqueProjetado, a.demanda?.mediaSemanal ?? 0) -
      diasDeEstoque(b.estoqueProjetado, b.demanda?.mediaSemanal ?? 0);
    const porViabilidadeNoturna = (a: FilaPrioridadeItem, b: FilaPrioridadeItem) =>
      qtdParaVirarNoite(a.placa.tempoPlacaHoras, janela.aberturaHora) -
      qtdParaVirarNoite(b.placa.tempoPlacaHoras, janela.aberturaHora);
    // Espelho diurno do critério acima: placas curtas (que dá pra trocar
    // durante o expediente) entram na frente — tempoPlacaHoras crescente.
    const porTrocabilidadeDiurna = (a: FilaPrioridadeItem, b: FilaPrioridadeItem) =>
      a.placa.tempoPlacaHoras - b.placa.tempoPlacaHoras;
    const porVolumeDeVenda = (a: FilaPrioridadeItem, b: FilaPrioridadeItem) =>
      (b.demanda?.mediaSemanal ?? 0) - (a.demanda?.mediaSemanal ?? 0);
    const porTempoDePlaca = (a: FilaPrioridadeItem, b: FilaPrioridadeItem) =>
      b.placa.tempoPlacaHoras - a.placa.tempoPlacaHoras;

    return itens.sort((a, b) => {
      const porEnvioFull = b.faltaEnvioFull - a.faltaEnvioFull;
      if (porEnvioFull !== 0) return porEnvioFull;
      const porBacklog = b.faltaDespacho - a.faltaDespacho;
      if (porBacklog !== 0) return porBacklog;
      const aVendeu = vendeuUltimasDuasSemanas(a.demanda) ? 0 : 1;
      const bVendeu = vendeuUltimasDuasSemanas(b.demanda) ? 0 : 1;
      const porVendaRecente = aVendeu - bVendeu;
      if (porVendaRecente !== 0) return porVendaRecente;
      const porDias = porDiasDeEstoque(a, b);
      if (porDias !== 0) return porDias;
      if (pertoDoFechamento) {
        const porViabilidade = porViabilidadeNoturna(a, b);
        if (porViabilidade !== 0) return porViabilidade;
      }
      const porVolume = porVolumeDeVenda(a, b);
      if (porVolume !== 0) return porVolume;
      if (!pertoDoFechamento) {
        const porTrocabilidade = porTrocabilidadeDiurna(a, b);
        if (porTrocabilidade !== 0) return porTrocabilidade;
      }
      return porTempoDePlaca(a, b);
    });
  }, [
    placas,
    demandaPorPlaca,
    pecasEmProducaoPorPlaca,
    pertoDoFechamento,
    janela.aberturaHora,
    filamento,
    enviosFullPorPlaca,
  ]);

  // Todas as ações abaixo seguem o mesmo padrão: marca a máquina como
  // "carregando" (feedback visual imediato no botão), faz a chamada,
  // espera só o refresh RÁPIDO (placas/produções/etc — ~1s) antes de
  // liberar o botão, e dispara o refresh de demanda em paralelo sem
  // esperar por ele — a fila de prioridade/aProduzir atualiza sozinha
  // assim que a ML/Shopee responderem, sem travar a tela até lá.
  async function iniciarProducao(
    placaId: number,
    machineId: number,
    quantidadePlacas: number,
    material: "PLA" | "PETG"
  ) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch("/api/producoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, placaId, quantidadePlacas, material }),
      });
      await carregarRapido();
      carregarDemanda();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
    }
  }

async function concluirProducao(id: number, machineId: number) {
  setCarregando((prev) => ({ ...prev, [machineId]: true }));
  try {
    const producaoAtual = producoes.find((p) => p.id === id);
    const detalhe = producaoAtual ? detalheProducao(producaoAtual) : null;
    const res = await fetch(`/api/producoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "concluida" }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && producaoAtual && detalhe && data) {
          const placaCadastro = placaPorId.get(producaoAtual.placa_id);
            const tempoMs = producaoAtual.iniciado_em ? Date.now() - new Date(producaoAtual.iniciado_em).getTime() : 0;
      if (!placaCadastro?.dadosConfirmados) {
            setResumoProducao({
                      producaoId: id,
        placaNome: producaoAtual.placa_nome,
        papel: placaCadastro ? placaCadastro.papel : null,
        pecasProduzidas: data.pecasProduzidas ?? detalhe.pecasProduzidas,
        falhas: data.pecasComFalha ?? detalhe.falhas,
        quantidadePlacas: detalhe.quantidadePlacas,
        pecasPorPlaca: detalhe.pecasPorPlaca,
        extra: detalhe.extra && data.pecasExtraProduzidas ? { placaNome: detalhe.extra.placaNome, pecas: data.pecasExtraProduzidas } : null,
        gramas: data.gramasFilamentoDescontadas ?? 0,
                cor: placaCadastro ? corFilamentoDaPlaca(placaCadastro.nome) : null,
                        tempoMs,
      });
      }
    }
    await carregarRapido();
    carregarDemanda();
  } finally {
    setCarregando((prev) => ({ ...prev, [machineId]: false }));
  }
}

  function fecharResumo() {
      setResumoProducao(null);
      setEditandoPeso(false);
      setValorPesoEditado("");
          setErroCorrecao(null);
          setEditandoTempo(false);
          setHorasEditadas("");
          setMinutosEditados("");
          setErroTempo(null);
    setEditandoPecas(false);
    setValorPecasEditado("");
    setErroPecas(null);
  }
  
  async function corrigirPeso() {
      if (!resumoProducao) return;
      const valor = Number(valorPesoEditado.replace(",", "."));
      if (!Number.isFinite(valor) || valor < 0) {
            setErroCorrecao("Informe um valor valido.");
            return;
      }
      setSalvandoCorrecao(true);
      setErroCorrecao(null);
      try {
            const res = await fetch(`/api/producoes/${resumoProducao.producaoId}/corrigir-filamento`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ gramasCorretas: valor }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data) {
                    setErroCorrecao((data && data.error) || "Erro ao salvar correcao.");
                    return;
            }
            setResumoProducao((prev) => (prev ? { ...prev, gramas: data.gramasNovas } : prev));
            setEditandoPeso(false);
            await carregarRapido();
      } finally {
            setSalvandoCorrecao(false);
      }
  }
  
async function corrigirTempo() {
    if (!resumoProducao) return;
    const h = Number(horasEditadas.replace(",", ".")) || 0;
    const m = Number(minutosEditados.replace(",", ".")) || 0;
    const horasTotal = h + m / 60;
    if (!Number.isFinite(horasTotal) || horasTotal <= 0) {
          setErroTempo("Informe um tempo valido.");
          return;
    }
    setSalvandoTempo(true);
    setErroTempo(null);
    try {
          const res = await fetch(`/api/producoes/${resumoProducao.producaoId}/corrigir-tempo`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ horasCorretas: horasTotal }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok || !data) {
                  setErroTempo((data && data.error) || "Erro ao salvar correcao.");
                  return;
          }
          setResumoProducao((prev) => (prev ? { ...prev, tempoMs: horasTotal * 3600000 } : prev));
          setEditandoTempo(false);
          await carregarRapido();
    } finally {
          setSalvandoTempo(false);
    }
}

  async function corrigirPecas() {
    if (!resumoProducao) return;
    const valor = Number(valorPecasEditado.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      setErroPecas("Informe um valor valido.");
      return;
    }
    setSalvandoPecas(true);
    setErroPecas(null);
    try {
      const res = await fetch(`/api/producoes/${resumoProducao.producaoId}/corrigir-pecas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pecasCorretas: valor }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setErroPecas((data && data.error) || "Erro ao salvar correcao.");
        return;
      }
      setResumoProducao((prev) => (prev ? { ...prev, pecasProduzidas: data.pecasNovas, pecasPorPlaca: data.pecasPlacaNovo } : prev));
      setEditandoPecas(false);
      await carregarRapido();
    } finally {
      setSalvandoPecas(false);
    }
  }
  
  async function cancelarProducao(id: number, machineId: number) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch(`/api/producoes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelada" }),
      });
      await carregarRapido();
      carregarDemanda();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
    }
  }

  async function falhaPlaca(id: number, machineId: number, gramas: number) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch(`/api/producoes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "falha_placa", gramasDesperdicadas: gramas }),
      });
      await carregarRapido();
      carregarDemanda();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
    }
  }

  async function falhaPeca(id: number, machineId: number, pecaDescricao: string, gramas: number) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch(`/api/producoes/${id}/falha-peca`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pecaDescricao, gramas }),
      });
      await carregarRapido();
      carregarDemanda();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
    }
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
      <RelogioOperacao janela={janela} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Pedidos (últimos 30 dias)" value={String(demanda?.totalPedidos ?? 0)} />
        <Card label="Máquinas rodando" value={`${producoesEmAndamento.length}/${machines.length}`} />
        <Card label="Placas cadastradas" value={String(placas.length)} />
        <Card label="Peças vendidas no Full (semana)" value={String(totalFullSemana)} />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Consumo de filamento</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card
            label="Total já impresso"
            value={consumo ? formatGramas(consumo.gramasImpressas) : "—"}
          />
          <Card
            label="Total já desperdiçado"
            value={consumo ? formatGramas(consumo.gramasDesperdicadas) : "—"}
          />
          <Card
            label="Total consumido (impresso + perda)"
            value={
              consumo
                ? formatGramas(consumo.gramasImpressas + consumo.gramasDesperdicadas)
                : "—"
            }
          />
        </div>
        {consumo && consumo.placasSemPeso > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            {consumo.placasSemPeso} de {consumo.totalPlacas} placa(s) ainda sem
            peso/placa (g) cadastrado — a parte calculada automaticamente do
            total impresso ({formatGramas(consumo.gramasImpressasCalculadas)})
            fica <span className="font-medium">subestimada</span> até isso ser
            preenchido. Preencha o campo &quot;Peso/placa (g)&quot; na tabela
            abaixo (usar o peso real de filamento gasto por placa impressa,
            não o peso da peça pronta).
          </p>
        )}
        {consumo && <ImpressoManualEditor consumo={consumo} onSalvar={salvarImpressoManualKg} />}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Estoque de filamento por cor</h2>
        <p className="mb-3 text-xs text-gray-500">
          Visualização em tempo real — atualiza sozinha a cada baixa de
          produção, falha de placa, perda registrada ou compra. Cor com 0kg
          bloqueia automaticamente a fila de prioridade abaixo pra todas as
          placas daquela cor. Pra editar o estoque, adicionar filamento
          (compra) ou ver o histórico de movimentação, use a aba{" "}
          <Link href="/estoque" className="font-medium text-blue-600 hover:underline">
            Estoque
          </Link>
          .
        </p>
        {filamento ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {CORES_FILAMENTO.map((cor) => {
              const valor = filamento[cor] ?? 0;
              const zerado = valor <= 0;
              return (
                <div
                  key={cor}
                  className={
                    "rounded border px-3 py-2 " +
                    (zerado ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50")
                  }
                >
                  <p className="text-xs text-gray-500">{LABEL_COR_FILAMENTO[cor]}</p>
                  <p className={"text-lg font-semibold " + (zerado ? "text-red-700" : "text-gray-900")}>
                    {formatGramasEmKg(valor)} kg
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Carregando estoque de filamento...</p>
        )}
        <div className="mt-3">
          <PerdaFilamentoForm onRegistrar={registrarPerdaFilamento} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Índice de falhas</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Card
            label="% Impresso (aproveitamento)"
            value={consumo ? `${consumo.percentualImpresso.toFixed(1)}%` : "—"}
          />
          <Card
            label="Taxa de falha real (por peso)"
            value={consumo ? `${consumo.percentualFalha.toFixed(1)}%` : "—"}
          />
          <Card
            label="Peças com falha"
            value={consumo ? String(consumo.pecasComFalha) : "—"}
          />
          <Card
            label="Peças rodadas (total)"
            value={consumo ? String(consumo.pecasRodadas) : "—"}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Calculado por peso de filamento (gramas), não por contagem de
          peças — uma peça grande que falha pesa muito mais que uma
          pequena, e é o material desperdiçado que reflete o prejuízo real
          da operação. Taxa de falha = desperdiçado ÷ (impresso +
          desperdiçado), sobre tudo já registrado até hoje. A contagem de
          peças ao lado fica só como referência.
        </p>
      </section>

      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
        <p className="font-semibold">
          Janela de operação: {formatHora(janela.aberturaHora)} às{" "}
          {formatHora(janela.fechamentoHora)}
          {janela.aprendido ? " (aprendida)" : " (padrão — ainda sem carregamentos suficientes pra aprender)"}
        </p>
        <p className="mt-1">
          A fila de prioridade abaixo sempre ordena primeiro por &quot;dias de
          estoque restante&quot; — produto vendido sem estoque é prioridade
          máxima, em qualquer horário. Perto do fechamento (ou já fechado)
          ninguém troca placa até a reabertura — por isso, nesse período, a
          fila dá preferência a quem cobre a madrugada sozinho (poucas
          recargas), em vez de uma placa rápida que termina e fica parada até
          alguém voltar; essa é uma restrição operacional real, por isso entra
          antes do volume de venda. Fora desse período, é sempre o volume de
          venda (quem vende mais por semana) que desempata primeiro — placas
          curtas (fáceis de trocar durante o expediente) só entram como
          desempate residual entre produtos de volume igual.
        </p>
        {pertoDoFechamento ? (
          <p className="mt-1 font-medium">
            Estamos nesse período agora — a fila abaixo já está priorizando
            quem cobre a madrugada sem precisar de recarga.
          </p>
        ) : (
          <p className="mt-1 font-medium">
            Estamos em horário de expediente — a fila abaixo está ordenada por
            volume de venda entre produtos igualmente urgentes.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Lembrete Full</p>
        <p className="mt-1">
          Vendas Full não descontam o estoque local, mas precisam ser repostas —
          use a coluna &quot;Vendido no Full (semana)&quot; abaixo pra saber o que
          incluir no próximo envio (você monta o Full toda segunda-feira).
        </p>
      </div>

      {demanda?.shopeeConectada === false && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-semibold">Shopee não conectada</p>
          <p className="mt-1">
            A demanda e a fila de prioridade abaixo estão calculadas só com as
            vendas do Mercado Livre — a Shopee não está conectada (ou a sessão
            expirou). &quot;A produzir&quot; pode estar subestimado pra
            produtos que também vendem lá. Reconecte na aba{" "}
            <Link href="/vendas?plataforma=shopee" className="underline">
              Vendas
            </Link>
            .
          </p>
        </div>
      )}

      {(demanda?.naoIdentificadoSemana?.qtyPeriodo ?? 0) > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">
            {demanda?.naoIdentificadoSemana?.qtyPeriodo} peça(s) vendida(s) nos
            últimos 7 dias não bateram com nenhuma placa do catálogo
            {(demanda?.naoIdentificadoSemana?.qtyFull ?? 0) > 0 &&
              ` (${demanda?.naoIdentificadoSemana?.qtyFull} no Full)`}
            .
          </p>
          <p className="mt-1 text-red-800">
            Ou o produto ainda não está cadastrado em Produção, ou o anúncio da
            ML não tem um SKU customizado que bata com o catálogo. Esses itens
            NÃO entram nas contas de demanda/Full acima. Exemplos:
          </p>
          <ul className="mt-2 space-y-1 pl-0">
            {demanda?.naoIdentificadoSemana?.amostras.slice(0, 8).map((a, i) => (
              <li key={i} className="flex items-start justify-between gap-3">
                <span className="list-disc before:mr-1.5 before:content-['•']">
                  {a.titulo} {a.sku && `(SKU: ${a.sku})`}
                  {a.itemId && a.itemId !== "—" && ` (item: ${a.itemId})`} —{" "}
                  {a.quantity}x
                  {a.isFull ? " · Full" : ""}
                </span>
                <button
                  onClick={() => ignorarItem(a.titulo, a.sku)}
                  className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100"
                  title="Não vendemos mais esse produto — parar de mostrar esse aviso"
                >
                  Não vendemos mais
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Impressoras</h2>
          {!mostrarNovaMaquina && (
            <button
              onClick={() => setMostrarNovaMaquina(true)}
              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
              title="Cadastrar impressora nova"
            >
              + Nova impressora
            </button>
          )}
        </div>

        {/* Cadastro self-service de impressora nova — pedido do Guilherme
            em 2026-08-04, ver adicionarMaquina() acima. */}
        {mostrarNovaMaquina && (
          <div className="mb-3 flex items-center gap-2 rounded border border-gray-200 bg-gray-50 p-2">
            <input
              autoFocus
              value={nomeNovaMaquina}
              onChange={(e) => setNomeNovaMaquina(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") adicionarMaquina();
                if (e.key === "Escape") {
                  setMostrarNovaMaquina(false);
                  setNomeNovaMaquina("");
                }
              }}
              placeholder="Nome da impressora (ex: Impressora 5)"
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
            />
            <button
              onClick={adicionarMaquina}
              disabled={salvandoMaquina || !nomeNovaMaquina.trim()}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {salvandoMaquina ? "Salvando..." : "Adicionar"}
            </button>
            <button
              onClick={() => {
                setMostrarNovaMaquina(false);
                setNomeNovaMaquina("");
              }}
              className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancelar
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {machines.map((machine) => (
            <PrinterCard
              key={machine.id}
              machine={machine}
              producao={producaoPorMachine.get(machine.id)}
              placaPorId={placaPorId}
              filaPrioridade={filaPrioridade}
              pertoDoFechamento={pertoDoFechamento}
              aberturaHora={janela.aberturaHora}
              carregando={Boolean(carregando[machine.id])}
              onIniciar={(placaId, qtd, material) =>
                iniciarProducao(placaId, machine.id, qtd, material)
              }
              onConcluir={(id) => concluirProducao(id, machine.id)}
              onCancelar={(id) => cancelarProducao(id, machine.id)}
              onFalhaPlaca={(id, gramas) => falhaPlaca(id, machine.id, gramas)}
              onFalhaPeca={(id, desc, gramas) => falhaPeca(id, machine.id, desc, gramas)}
              onRenomear={renomearMaquina}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Fila de prioridade ({filaPrioridade.length})
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          Sempre ordenada, primeiro, por &quot;dias de estoque restante&quot;
          (estoque ÷ venda média diária) — produto com venda real e sem
          estoque é nível 1 de prioridade, em qualquer horário; isso nunca
          muda (a meta usada aqui é 1 mês de venda × 1.3, somando venda
          normal e Full; placa descontinuada nunca entra aqui, mesmo com
          alguma venda residual detectada). Depois disso, perto do
          fechamento (ou já fechado) entra primeiro quantas recargas a placa
          precisaria pra cobrir a madrugada sozinha (coluna &quot;Qtd p/
          virar a noite&quot;) — uma placa que precisaria de 8 recargas (ex:
          9x) perde pra outra igualmente urgente que uma única carga já
          segura até a reabertura ({formatHora(janela.aberturaHora)}), já que
          ninguém troca placa de madrugada; essa é uma restrição real, por
          isso vem antes do volume de venda. Em qualquer outro horário (e
          sempre, depois da regra acima), quem vende mais por semana entra na
          frente — isso nunca perde pra tempo de placa. Só quando o volume de
          venda também empata é que placas curtas (1 a 5h, fáceis de trocar
          durante o expediente) desempatam por último. Use o campo de busca
          por SKU em cada impressora se quiser carregar um produto fora dessa
          ordem.
        </p>
        {filaPrioridade.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-center text-sm text-gray-500">
            Nada pendente — estoque cobre a meta de 1 mês de venda (×1.3).
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
                  <th className="px-3 py-2 text-right">Dias de estoque</th>
                  <th className="px-3 py-2 text-right">Meta</th>
                  <th className="px-3 py-2 text-right">A produzir</th>
                  <th className="px-3 py-2 text-right">Qtd p/ virar a noite</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filaPrioridade.map((item, idx) => {
                  const dias = diasDeEstoque(
                    item.estoqueProjetado,
                    item.demanda?.mediaSemanal ?? 0
                  );
                  return (
                    <tr key={item.placa.id}>
                      <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {item.placa.nome}
                        {item.faltaEnvioFull > 0 && (
                          <span
                            className="ml-2 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-normal text-purple-700"
                            title={`Faltam ${item.faltaEnvioFull} peça(s) pra cobrir envio(s) do Full planejados na aba Full — prioridade extraordinária, acima até do backlog de despacho.`}
                          >
                            faltam {item.faltaEnvioFull}pç p/ envio Full
                          </span>
                        )}
                        {item.faltaDespacho > 0 && (
                          <span
                            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-700"
                            title={`Faltam ${item.faltaDespacho} peça(s) pra cobrir pedidos já pagos e ainda não despachados — backlog real, prioridade acima de tudo.`}
                          >
                            faltam {item.faltaDespacho}pç p/ despachar
                          </span>
                        )}
                        {!vendeuUltimasDuasSemanas(item.demanda) && (
                          <span
                            className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500"
                            title="Última venda há mais de 14 dias (ou nenhuma nos últimos 30) — por isso caiu pro fim da fila, mesmo sem estoque."
                          >
                            sem venda recente
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <TierBadge tier={item.placa.tier} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {item.placa.estoque}
                        {item.emProducao > 0 && (
                          <span
                            className="ml-1 text-xs font-normal text-blue-600"
                            title="Já sendo produzido agora em outra impressora"
                          >
                            +{item.emProducao} em produção
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={
                            Number.isFinite(dias) && dias <= 3
                              ? "font-semibold text-red-600"
                              : "text-gray-700"
                          }
                        >
                          {Number.isFinite(dias) ? dias.toFixed(1) : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">
                        {item.demanda?.recomendadoEstoque ?? 0}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">
                        {item.aProduzirEfetivo}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">
                        {qtdParaVirarNoite(item.placa.tempoPlacaHoras, janela.aberturaHora)}x
                      </td>
                    </tr>
                  );
                })}
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
          &quot;Meta&quot; = 1 mês de venda estimado × 1.3 (a partir dos
          últimos 30 dias — vendas locais e Full somadas). &quot;A
          produzir&quot; = meta − estoque atual. Pra placas compostas
          (corpo+gancho), o estoque
          &quot;vendável&quot; do produto final é o menor entre as duas
          metades do par. &quot;Peso/placa (g)&quot; é o peso de filamento
          gasto pra imprimir 1 placa inteira (não o peso da peça pronta) —
          alimenta os cards de &quot;Consumo de filamento&quot; acima; clique
          no valor pra editar.
        </p>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Estoque</th>
                <th className="px-3 py-2 text-right">Vendável (grupo)</th>
                <th className="px-3 py-2 text-right">Vendido (30d)</th>
                <th className="px-3 py-2 text-right">Média/semana</th>
                <th className="px-3 py-2 text-right">Full (7d)</th>
                <th className="px-3 py-2 text-right">Meta</th>
                <th className="px-3 py-2 text-right">A produzir</th>
                <th className="px-3 py-2 text-right">Peso/placa (g)</th>
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
                    <td className="px-3 py-2 text-right">{d?.qtyVendidaPeriodo ?? 0}</td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {d ? d.mediaSemanal.toFixed(1) : "0.0"}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-700">
                      {d?.qtyVendidaFull ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {d?.recomendadoEstoque ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      {d?.aProduzir ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <PesoPlacaInput placa={placa} onSalvar={salvarPesoPlaca} />
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
                {producoesRecentes.map((p) => {
                  const expandida = producaoExpandidaId === p.id;
                  const clicavel = p.status === "concluida";
                  const detalhe = clicavel ? detalheProducao(p) : null;
                  return (
                    <Fragment key={p.id}>
                      <tr
                        onClick={
                          clicavel
                            ? () => setProducaoExpandidaId(expandida ? null : p.id)
                            : undefined
                        }
                        className={clicavel ? "cursor-pointer hover:bg-gray-50" : undefined}
                      >
                        <td className="px-4 py-2 text-gray-700">{p.machine_nome}</td>
                        <td className="px-4 py-2 text-gray-700">
                          {clicavel && (
                            <span className="mr-1 inline-block text-gray-400">
                              {expandida ? "▾" : "▸"}
                            </span>
                          )}
                          {p.placa_nome}
                        </td>
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
                      {expandida && detalhe && (
                        <tr className="bg-blue-50/50">
                          <td colSpan={6} className="px-4 py-3 text-xs text-gray-700">
                            <p className="mb-1 font-medium text-gray-900">
                              {detalhe.pecasProduzidas} peça(s) impressa(s)
                              {detalhe.falhas > 0 && (
                                <span className="font-normal text-gray-500">
                                  {" "}
                                  ({detalhe.quantidadePlacas} placa(s) × {detalhe.pecasPorPlaca}{" "}
                                  peça(s)/placa − {detalhe.falhas} com falha)
                                </span>
                              )}
                            </p>
                            <p className="text-emerald-700">
                              + {detalhe.pecasProduzidas} peça(s) entraram no estoque de{" "}
                              <span className="font-medium">{p.placa_nome}</span>
                            </p>
                            {detalhe.extra && (
                              <p className="text-emerald-700">
                                + {detalhe.extra.pecas} peça(s) entraram no estoque de{" "}
                                <span className="font-medium">{detalhe.extra.placaNome}</span>{" "}
                                <span className="text-gray-500">(saída extra da placa mista)</span>
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {resumoProducao && createElement("div", {className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4", onClick: () => setResumoProducao(null)}, createElement("div", {className: "w-full max-w-sm rounded-lg bg-white p-5 shadow-xl", onClick: (e: any) => e.stopPropagation()}, createElement("p", {className: "mb-1 text-xs font-medium uppercase tracking-wide text-emerald-600"}, "Produção concluída"), createElement("h3", {className: "mb-3 text-base font-semibold text-gray-900"}, resumoProducao.placaNome + (resumoProducao.papel ? ` (${resumoProducao.papel})` : "")), createElement("p", {className: "text-sm text-gray-700"}, `${resumoProducao.pecasProduzidas} peça(s)${resumoProducao.papel ? ` de ${resumoProducao.papel}` : ""} produzida(s) (${resumoProducao.quantidadePlacas} placa(s) x ${resumoProducao.pecasPorPlaca} peça(s)/placa${resumoProducao.falhas > 0 ? ` - ${resumoProducao.falhas} com falha` : ""})`), resumoProducao.extra && createElement("p", {className: "text-sm text-emerald-700"}, `+ ${resumoProducao.extra.pecas} peça(s) de ${resumoProducao.extra.placaNome} (saída extra da placa mista)`), createElement("p", {className: "text-sm text-gray-500"}, "Tempo: ", editandoTempo ? createElement("span", {className: "inline-flex items-center gap-1"}, createElement("input", {type: "number", min: 0, step: "1", autoFocus: true, value: horasEditadas, onChange: (e: any) => setHorasEditadas(e.target.value), className: "w-12 rounded border border-gray-300 px-1.5 py-0.5 text-right"}), "h", createElement("input", {type: "number", min: 0, max: 59, step: "1", value: minutosEditados, onChange: (e: any) => setMinutosEditados(e.target.value), className: "w-12 rounded border border-gray-300 px-1.5 py-0.5 text-right"}), "min", createElement("button", {onClick: corrigirTempo, disabled: salvandoTempo, className: "ml-1 text-xs text-blue-600 hover:underline"}, salvandoTempo ? "Salvando..." : "Salvar"), createElement("button", {onClick: () => { setEditandoTempo(false); setErroTempo(null); }, className: "ml-1 text-xs text-gray-400 hover:underline"}, "cancelar")) : createElement("span", null, formatDuracaoMs(resumoProducao.tempoMs), createElement("button", {onClick: () => { const totalMin = Math.round(resumoProducao.tempoMs / 60000); setHorasEditadas(String(Math.floor(totalMin / 60))); setMinutosEditados(String(totalMin % 60)); setEditandoTempo(true); setErroTempo(null); }, className: "ml-2 text-xs text-blue-600 hover:underline"}, "editar"))), erroTempo && createElement("p", {className: "mt-1 text-xs text-red-600"}, erroTempo), createElement("p", {className: "mt-2 text-sm text-gray-700"}, "Filamento gasto: ", editandoPeso ? createElement("span", {className: "inline-flex items-center gap-1"}, createElement("input", {type: "number", min: 0, step: "1", autoFocus: true, value: valorPesoEditado, onChange: (e: any) => setValorPesoEditado(e.target.value), className: "w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right"}), "g", createElement("button", {onClick: corrigirPeso, disabled: salvandoCorrecao, className: "ml-1 text-xs text-blue-600 hover:underline"}, salvandoCorrecao ? "Salvando..." : "Salvar"), createElement("button", {onClick: () => { setEditandoPeso(false); setErroCorrecao(null); }, className: "ml-1 text-xs text-gray-400 hover:underline"}, "cancelar")) : createElement("span", null, `${formatGramasEmKg(resumoProducao.gramas)} kg${resumoProducao.cor ? ` (${resumoProducao.cor})` : ""}`, createElement("button", {onClick: () => { setValorPesoEditado(String(Math.round(resumoProducao.gramas))); setEditandoPeso(true); setErroCorrecao(null); }, className: "ml-2 text-xs text-blue-600 hover:underline"}, "editar"))), erroCorrecao && createElement("p", {className: "mt-1 text-xs text-red-600"}, erroCorrecao), createElement("p", {className: "mt-2 text-sm text-gray-700"}, "Quantidade de peças/placa: ", editandoPecas ? createElement("span", {className: "inline-flex items-center gap-1"}, createElement("input", {type: "number", min: 0, step: "1", autoFocus: true, value: valorPecasEditado, onChange: (e: any) => setValorPecasEditado(e.target.value), className: "w-16 rounded border border-gray-300 px-1.5 py-0.5 text-right"}), createElement("button", {onClick: corrigirPecas, disabled: salvandoPecas, className: "ml-1 text-xs text-blue-600 hover:underline"}, salvandoPecas ? "Salvando..." : "Salvar"), createElement("button", {onClick: () => { setEditandoPecas(false); setErroPecas(null); }, className: "ml-1 text-xs text-gray-400 hover:underline"}, "cancelar")) : createElement("span", null, String(resumoProducao.pecasPorPlaca), createElement("button", {onClick: () => { setValorPecasEditado(String(resumoProducao.pecasPorPlaca)); setEditandoPecas(true); setErroPecas(null); }, className: "ml-2 text-xs text-blue-600 hover:underline"}, "editar"))), erroPecas && createElement("p", {className: "mt-1 text-xs text-red-600"}, erroPecas), createElement("button", {onClick: fecharResumo, className: "mt-4 w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"}, "Fechar")))}
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

// Campo pra informar manualmente o total já impresso ANTES do cadastro
// de peso/placa existir (ex: "eu sei que já gastei uns 40kg de filamento
// desde que comecei a rodar o sistema") — soma com o que for calculado
// automaticamente das produções concluídas dali em diante. Guarda em kg
// na tela (mais prático pra declarar um total histórico) mas converte
// pra gramas ao salvar, já que é essa a unidade usada no resto do app.
function ImpressoManualEditor({
  consumo,
  onSalvar,
}: {
  consumo: ConsumoResult;
  onSalvar: (kg: number) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(consumo.gramasImpressasManual / 1000));
  const [salvando, setSalvando] = useState(false);

  if (!editando) {
    return (
      <p className="mt-3 text-xs text-gray-500">
        Total informado manualmente (impresso antes do cadastro de peso/placa):{" "}
        <span className="font-medium text-gray-700">
          {formatGramas(consumo.gramasImpressasManual)}
        </span>{" "}
        <button
          onClick={() => {
            setValor(String(consumo.gramasImpressasManual / 1000));
            setEditando(true);
          }}
          className="text-blue-600 hover:underline"
        >
          editar
        </button>
      </p>
    );
  }

  return (
    <div className="mt-3 flex items-center gap-1.5 text-xs">
      <span className="text-gray-500">
        Total já impresso antes do cadastro de peso/placa (kg):
      </span>
      <input
        type="number"
        min={0}
        step="0.1"
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        className="w-24 rounded border border-gray-300 px-1.5 py-0.5 text-right"
      />
      <button
        disabled={salvando}
        onClick={async () => {
          setSalvando(true);
          try {
            await onSalvar(Number(valor) || 0);
            setEditando(false);
          } finally {
            setSalvando(false);
          }
        }}
        className="rounded bg-gray-900 px-2 py-0.5 font-medium text-white hover:bg-gray-700 disabled:opacity-40"
      >
        Salvar
      </button>
      <button onClick={() => setEditando(false)} className="text-gray-400 hover:underline">
        cancelar
      </button>
    </div>
  );
}

// Nomes de exibição das cores controladas — mesma ordem de CORES_FILAMENTO.
// Usado pelo card de leitura acima e pelo formulário de perda abaixo. A
// edição de estoque (FilamentoEditor), o histórico (HistoricoFilamento) e
// o pedido de compra mudaram pra aba Estoque em 2026-07-28/29 (pedido do
// Guilherme: "O Estoque do filamento deve ser controlado em estoque") —
// só o "Registrar perda" voltou pra cá em 2026-07-29 ("Registrar perda,
// deve estar na aba de producao"), porque a perda normalmente é
// percebida durante o trabalho na máquina.
const LABEL_COR_FILAMENTO: Record<CorFilamento, string> = {
  colorido: "Colorido",
  preto: "Preto",
  "preto-petg": "Preto (PETG)",
  branco: "Branco",
  "branco-petg": "Branco (PETG)",
  prata: "Prata",
  marrom: "Marrom",
  bege: "Bege",
  vermelho: "Vermelho",
  "vermelho-petg": "Vermelho (PETG)",
};

function PerdaFilamentoForm({
  onRegistrar,
}: {
  onRegistrar: (cor: CorFilamento, gramas: number, motivo: string) => Promise<string | null>;
}) {
  const [cor, setCor] = useState<CorFilamento>("colorido");
  const [gramas, setGramas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  async function registrar() {
    const gramasNum = Number(gramas);
    if (!Number.isFinite(gramasNum) || gramasNum <= 0) {
      setErro("Informe a quantidade em gramas (maior que 0).");
      return;
    }
    setErro(null);
    setSucesso(false);
    setSalvando(true);
    try {
      const erroApi = await onRegistrar(cor, gramasNum, motivo.trim());
      if (erroApi) {
        setErro(erroApi);
        return;
      }
      setGramas("");
      setMotivo("");
      setSucesso(true);
      setTimeout(() => setSucesso(false), 3000);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
      <p className="text-xs font-medium text-gray-600">
        Registrar perda avulsa de filamento (fora de uma produção — ex: purga,
        calibração, filamento emaranhado)
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Cor</span>
          <select
            value={cor}
            onChange={(e) => setCor(e.target.value as CorFilamento)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {CORES_FILAMENTO.map((c) => (
              <option key={c} value={c}>
                {LABEL_COR_FILAMENTO[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Gramas</span>
          <input
            type="number"
            min={0}
            step="1"
            value={gramas}
            onChange={(e) => setGramas(e.target.value)}
            placeholder="0"
            className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-1 min-w-[180px] flex-col gap-1">
          <span className="text-xs font-medium text-gray-500">Motivo (opcional)</span>
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex: purga na troca de cor"
            maxLength={200}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          disabled={salvando}
          onClick={registrar}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {salvando ? "Registrando..." : "Registrar perda"}
        </button>
      </div>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      {sucesso && <p className="text-xs text-green-600">Perda registrada e descontada do estoque.</p>}
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

// Célula editável de "peso/placa (g)" — mostra o valor cadastrado (ou um
// aviso discreto se ainda não foi confirmado) e vira um input ao clicar,
// pra não precisar de uma tela separada só pra esse cadastro.
function PesoPlacaInput({
  placa,
  onSalvar,
}: {
  placa: PlacaRow;
  onSalvar: (placaId: number, pesoPlacaGramas: number | null) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(
    placa.pesoPlacaGramas !== null ? String(placa.pesoPlacaGramas) : ""
  );
  const [salvando, setSalvando] = useState(false);

  if (!editando) {
    return (
      <button
        onClick={() => {
          setValor(placa.pesoPlacaGramas !== null ? String(placa.pesoPlacaGramas) : "");
          setEditando(true);
        }}
        className={
          placa.pesoPlacaGramas !== null
            ? "text-gray-700 hover:underline"
            : "text-amber-600 hover:underline"
        }
        title="Clique pra editar"
      >
        {placa.pesoPlacaGramas !== null ? `${placa.pesoPlacaGramas}g` : "não confirmado"}
      </button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="number"
        min={0}
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key !== "Enter") return;
          setSalvando(true);
          try {
            await onSalvar(placa.id, valor.trim() === "" ? null : Number(valor));
            setEditando(false);
          } finally {
            setSalvando(false);
          }
        }}
        className="w-20 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
      />
      <button
        disabled={salvando}
        onClick={async () => {
          setSalvando(true);
          try {
            await onSalvar(placa.id, valor.trim() === "" ? null : Number(valor));
            setEditando(false);
          } finally {
            setSalvando(false);
          }
        }}
        className="rounded bg-gray-900 px-1.5 py-0.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
      >
        OK
      </button>
    </div>
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
  pertoDoFechamento,
  aberturaHora,
  carregando,
  onIniciar,
  onConcluir,
  onCancelar,
  onFalhaPlaca,
  onFalhaPeca,
  onRenomear,
}: {
  machine: MachineRow;
  producao?: ProducaoRow;
  placaPorId: Map<number, PlacaRow>;
  filaPrioridade: FilaPrioridadeItem[];
  pertoDoFechamento: boolean;
  aberturaHora: number;
  carregando: boolean;
  onIniciar: (placaId: number, quantidadePlacas: number, material: "PLA" | "PETG") => void;
  onConcluir: (id: number) => void;
  onCancelar: (id: number) => void;
  onFalhaPlaca: (id: number, gramas: number) => void;
  onFalhaPeca: (id: number, pecaDescricao: string, gramas: number) => void;
  onRenomear: (id: number, nome: string) => void;
}) {
  const [showFalhaPlaca, setShowFalhaPlaca] = useState(false);
  const [showFalhaPeca, setShowFalhaPeca] = useState(false);
  const [gramasPlaca, setGramasPlaca] = useState("");
  const [pecaDescricao, setPecaDescricao] = useState("");
  const [gramasPeca, setGramasPeca] = useState("");
  // Renomear impressora inline — pedido do Guilherme em 2026-08-04, ver
  // onRenomear (bate em PATCH /api/machines/[id]).
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEditado, setNomeEditado] = useState(machine.nome);
  useEffect(() => {
    if (!editandoNome) setNomeEditado(machine.nome);
  }, [machine.nome, editandoNome]);

  function salvarNome() {
    const nome = nomeEditado.trim();
    if (nome && nome !== machine.nome) onRenomear(machine.id, nome);
    setEditandoNome(false);
  }

  // placaPorId vem de /api/placas, que filtra "descontinuada = false" — uma
  // placa que estava rodando e foi descontinuada DEPOIS de carregada na
  // máquina some desse mapa. Bug reportado pelo Guilherme em 2026-07-29:
  // "mostra como rodando mas não mostra o que está rodando" (Impressora 2
  // e 3). Antes disso, o corpo do card só renderizava com `producao &&
  // placa` — sem a placa no mapa, caía no formulário vazio de carregar
  // máquina mesmo com o badge certo dizendo "Rodando". Correção: usar
  // producao.placa_nome/pecas_por_placa (que /api/producoes já traz, SEM
  // filtro de descontinuada) como dado principal; placaPorId só
  // complementa quando disponível, nunca bloqueia a renderização.
  const placa = producao ? placaPorId.get(producao.placa_id) : undefined;
  const placaNome = placa?.nome ?? producao?.placa_nome ?? "";
  const pecasPorPlaca = placa?.pecasPorPlaca ?? Number(producao?.pecas_por_placa ?? 0);
  const totalPecas = producao ? Number(producao.quantidade_placas) * pecasPorPlaca : 0;
  // Placa "Mista" (papel='corpo' com saída extra pro Gancho Compartilhado)
  // — pedido do Guilherme em 2026-07-31, olhando o card rodando "Suporte
  // BMW - Mista (Preto)": "Está mostrando que é feita 3 por placa, mas na
  // verdade é 3 corpo e 2 ganchos" — o card só mostrava o crédito PRÓPRIO
  // da placa (pç/placa), sem indicar a saída extra que também é creditada
  // (em OUTRA placa) quando a produção é concluída (ver saidaExtraPecas
  // em PATCH /api/producoes/[id]). Mostra a placa de destino da saída
  // extra pelo nome (via placaPorId), pra deixar claro que concluir essa
  // impressão credita duas linhas de estoque diferentes.
  const placaExtra =
    placa?.saidaExtraPlacaId && placa.saidaExtraPecas
      ? placaPorId.get(placa.saidaExtraPlacaId)
      : undefined;
  const totalPecasExtra =
    producao && placa?.saidaExtraPecas
      ? Number(producao.quantidade_placas) * placa.saidaExtraPecas
      : 0;

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        {editandoNome ? (
          <div className="flex flex-1 items-center gap-1">
            <input
              autoFocus
              value={nomeEditado}
              onChange={(e) => setNomeEditado(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") salvarNome();
                if (e.key === "Escape") {
                  setNomeEditado(machine.nome);
                  setEditandoNome(false);
                }
              }}
              className="w-full min-w-0 rounded border border-gray-300 px-1 py-0.5 text-sm font-semibold text-gray-900"
            />
            <button onClick={salvarNome} className="shrink-0 text-xs font-medium text-green-700" title="Salvar">
              ✓
            </button>
            <button
              onClick={() => {
                setNomeEditado(machine.nome);
                setEditandoNome(false);
              }}
              className="shrink-0 text-xs font-medium text-gray-500"
              title="Cancelar"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditandoNome(true)}
            className="group flex items-center gap-1 text-left"
            title="Renomear impressora"
          >
            <p className="font-semibold text-gray-900">{machine.nome}</p>
            <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100">✎</span>
          </button>
        )}
        <span
          className={
            "rounded-full px-2 py-0.5 text-xs font-medium " +
            (producao ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")
          }
        >
          {producao ? "Rodando" : "Livre"}
        </span>
      </div>

      {producao ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-gray-900">
              {placaNome}
              {producao.material === "PETG" && (
                <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-700">
                  PETG
                </span>
              )}
            </p>
            <p className="text-xs text-gray-500">
              {producao.quantidade_placas} placa(s) · {pecasPorPlaca} pç/placa ·{" "}
              {totalPecas} peças no total
            </p>
            {placaExtra && (
              <p className="text-xs text-amber-700">
                + {totalPecasExtra} pç de saída extra → {placaExtra.nome}
              </p>
            )}
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
              disabled={carregando}
              onClick={() => onConcluir(producao.id)}
              className="rounded bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {carregando ? "Salvando..." : "Placa impressa com sucesso"}
            </button>
            <button
              disabled={carregando}
              onClick={() => setShowFalhaPeca((v) => !v)}
              className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-40"
            >
              Falha em peça
            </button>
            <button
              disabled={carregando}
              onClick={() => setShowFalhaPlaca((v) => !v)}
              className="rounded border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
            >
              Falha na placa
            </button>
            <button
              disabled={carregando}
              onClick={() => onCancelar(producao.id)}
              className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:underline disabled:opacity-40"
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
                    disabled={!pecaDescricao.trim() || carregando}
                    onClick={() => {
                      onFalhaPeca(producao.id, pecaDescricao.trim(), Number(gramasPeca) || 0);
                      setPecaDescricao("");
                      setGramasPeca("");
                      setShowFalhaPeca(false);
                    }}
                    className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
                  >
                    {carregando ? "Salvando..." : "Registrar"}
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
                  disabled={carregando}
                  onClick={() => {
                    onFalhaPlaca(producao.id, Number(gramasPlaca) || 0);
                    setGramasPlaca("");
                    setShowFalhaPlaca(false);
                  }}
                  className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
                >
                  {carregando ? "Salvando..." : "Confirmar falha"}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <CarregarPlacaForm
          filaPrioridade={filaPrioridade}
          placaPorId={placaPorId}
          pertoDoFechamento={pertoDoFechamento}
          aberturaHora={aberturaHora}
          carregando={carregando}
          onIniciar={onIniciar}
        />
      )}
    </div>
  );
}

function CarregarPlacaForm({
  filaPrioridade,
  placaPorId,
  pertoDoFechamento,
  aberturaHora,
  carregando,
  onIniciar,
}: {
  filaPrioridade: FilaPrioridadeItem[];
  placaPorId: Map<number, PlacaRow>;
  pertoDoFechamento: boolean;
  aberturaHora: number;
  carregando: boolean;
  onIniciar: (placaId: number, quantidadePlacas: number, material: "PLA" | "PETG") => void;
}) {
  const [placaId, setPlacaId] = useState<number | "">(filaPrioridade[0]?.placa.id ?? "");
  const [quantidade, setQuantidade] = useState(1);
  const [buscaSku, setBuscaSku] = useState("");
  const [resultados, setResultados] = useState<SkuResult[]>([]);
  const [placaSelecionadaNome, setPlacaSelecionadaNome] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  // Material da placa carregada — só pergunta pras 3 cores que têm PETG
  // em estoque separado (ver CORES_COM_PETG em lib/placas.ts). Pedido do
  // Guilherme em 2026-07-29: "na hora da producao perguntar em qual
  // material esta usando, deixar uma tag clicavel". Sempre reseta pra
  // PLA quando troca de placa, pra nunca "vazar" a escolha de uma placa
  // pra outra sem querer.
  const [material, setMaterial] = useState<"PLA" | "PETG">("PLA");
  useEffect(() => {
    setMaterial("PLA");
  }, [placaId]);

  // Removida a sugestão automática de "carregar Nx pra virar a noite" —
  // pedido do Guilherme em 2026-07-24: na impressora dele só dá pra
  // carregar 1 placa de cada vez (não enfileira repetição sozinha à
  // noite), então uma sugestão de quantidade > 1 não reflete a realidade
  // do equipamento e só criava confusão/risco de erro. Ele prefere sempre
  // decidir manualmente qual placa carregar a cada troca — por isso
  // quantidade agora fica sempre em 1 por padrão (input abaixo continua
  // editável manualmente se algum dia fizer sentido). A coluna "Qtd p/
  // virar a noite" na fila de prioridade (informativa, ajuda a decidir
  // qual placa escolher) e o critério de desempate noturno continuam
  // existindo — só essa sugestão de auto-preencher a quantidade foi
  // removida.

  useEffect(() => {
    // Pedido do Guilherme em 2026-07-29: "quando escolhido, deve ficar
    // marcado no buscar qual sku foi selecionado" — agora o próprio campo
    // de busca fica preenchido com o SKU escolhido (ver onClick do
    // resultado abaixo) em vez de voltar vazio pro placeholder. Por isso
    // esse efeito precisa ignorar o próprio valor que ELE MESMO acabou de
    // colocar no campo (buscaSku === placaSelecionadaNome): sem essa
    // checagem, toda seleção dispararia uma busca nova pelo texto do
    // resultado escolhido e reabriria a lista por baixo, como se o
    // usuário tivesse digitado aquilo.
    if (buscaSku.trim().length < 2 || buscaSku === placaSelecionadaNome) {
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
  }, [buscaSku, placaSelecionadaNome]);

  // Tempo médio de impressão da placa escolhida — pedido do Guilherme em
  // 2026-07-24: mostrar como observação na hora de carregar, pra dar uma
  // noção de quando ela deve terminar (mesmo campo tempoPlacaHoras já
  // usado no cálculo de "Qtd p/ virar a noite" da fila de prioridade).
  const placaSelecionada = placaId ? placaPorId.get(placaId) : undefined;
  const corBase = placaSelecionada ? corFilamentoDaPlaca(placaSelecionada.nome) : null;
  const temOpcaoPetg = corBase !== null && CORES_COM_PETG.includes(corBase);
  // Mesmo aviso de saída extra do card "Rodando" (ver ImpressoraCard
  // acima) — pedido do Guilherme em 2026-07-31: o card só mostrava o
  // crédito próprio da placa (ex: "3 pç/placa"), escondendo que uma placa
  // "Mista" também credita peças em OUTRA placa (o Gancho Compartilhado)
  // quando a produção conclui. Mostrado aqui também, ANTES de carregar,
  // pra já avisar o operador na hora de escolher a placa, não só depois.
  const placaExtraSelecionada = placaSelecionada?.saidaExtraPlacaId
    ? placaPorId.get(placaSelecionada.saidaExtraPlacaId)
    : undefined;

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
          className={
            "w-full rounded border px-2 py-1.5 text-xs " +
            (buscaSku.length > 0 && buscaSku === placaSelecionadaNome
              ? "border-blue-400 bg-blue-50 font-medium text-blue-900"
              : "border-gray-300")
          }
        />
        {buscando && <p className="mt-1 text-xs text-gray-400">Buscando...</p>}
        {resultados.length > 0 && (
          <ul className="mt-1 max-h-48 overflow-y-auto rounded border border-gray-200 text-xs">
            {resultados.map((r) => (
              <li key={r.placa_id}>
                <button
                  onClick={() => {
                    setPlacaId(r.placa_id);
                    // Pedido do Guilherme: manter o SKU escolhido MARCADO
                    // no próprio campo de busca, em vez de limpar de volta
                    // pro placeholder — antes fazia setBuscaSku("") e só
                    // mostrava o nome numa linha azul separada embaixo.
                    setBuscaSku(`${r.sku} → ${r.placa_nome}`);
                    setPlacaSelecionadaNome(`${r.sku} → ${r.placa_nome}`);
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
            setBuscaSku("");
          }}
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
        >
          <option value="">Selecione uma placa</option>
          {filaPrioridade.map((item) => (
            <option key={item.placa.id} value={item.placa.id}>
              {item.placa.nome} — a produzir: {item.aProduzirEfetivo}
              {item.emProducao > 0 ? ` (${item.emProducao} já em produção)` : ""}
            </option>
          ))}
        </select>
      </div>

      {placaSelecionada && (
        <p className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
          Tempo médio de impressão: {formatHora(placaSelecionada.tempoPlacaHoras)}
          {quantidade > 1 ? ` por placa (${quantidade}x = ${formatHora(placaSelecionada.tempoPlacaHoras * quantidade)} no total)` : ""}
        </p>
      )}

      {placaExtraSelecionada && placaSelecionada?.saidaExtraPecas && (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Ao concluir, também credita {placaSelecionada.saidaExtraPecas * quantidade} pç em{" "}
          <span className="font-medium">{placaExtraSelecionada.nome}</span> (saída extra)
        </p>
      )}

      {temOpcaoPetg && (
        <div className="flex items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5">
          <span className="text-xs font-medium text-sky-800">Material:</span>
          <button
            type="button"
            onClick={() => setMaterial("PLA")}
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-semibold " +
              (material === "PLA"
                ? "bg-sky-600 text-white"
                : "bg-white text-sky-700 border border-sky-300")
            }
          >
            PLA
          </button>
          <button
            type="button"
            onClick={() => setMaterial("PETG")}
            className={
              "rounded-full px-2.5 py-0.5 text-xs font-semibold " +
              (material === "PETG"
                ? "bg-sky-600 text-white"
                : "bg-white text-sky-700 border border-sky-300")
            }
          >
            PETG
          </button>
        </div>
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
          onClick={() => placaId && onIniciar(placaId, quantidade, material)}
          className="flex-1 rounded bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {carregando ? "Carregando..." : "Carregar máquina"}
        </button>
      </div>
    </div>
  );
}
