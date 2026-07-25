"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PlacaRow,
  estoqueVendavel,
  CORES_FILAMENTO,
  CorFilamento,
  corFilamentoDaPlaca,
} from "@/lib/placas";
import { horaAtualSP, horasAteProximaAbertura } from "@/lib/date";
import {
  MachineRow,
  ProducaoRow,
  DemandaResult,
  DemandaPlacaRow,
  ConsumoResult,
  EstoqueFilamentoRow,
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
  // Envios planejados do Full ainda pendentes — pedido do Guilherme em
  // 2026-07-25: alimenta o critério nº-2 da fila de prioridade (ver
  // filaPrioridade abaixo).
  const [enviosFull, setEnviosFull] = useState<EnvioFullPendente[]>([]);
  const [carregando, setCarregando] = useState<Record<number, boolean>>({});
  // Só pra fazer a fila/sugestões reagirem sozinhas quando o relógio
  // cruza o horário de fechamento, sem precisar de uma ação manual pra
  // "acordar" a tela — atualiza a cada minuto.
  const [horaTick, setHoraTick] = useState(() => horaAtualSP());

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

  async function salvarFilamento(novo: EstoqueFilamentoRow) {
    setFilamento(novo);
    const salvo = await fetch("/api/producao/filamento", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(novo),
    }).then((r) => r.json());
    setFilamento(salvo);
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
      .filter(
        (item) =>
          item.aProduzirEfetivo > 0 || item.faltaDespacho > 0 || item.faltaEnvioFull > 0
      )
      .filter((item) => {
        if (!filamento) return true;
        const cor = corFilamentoDaPlaca(item.placa.nome);
        if (!cor) return true;
        return filamento[cor] > 0;
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
  async function iniciarProducao(placaId: number, machineId: number, quantidadePlacas: number) {
    setCarregando((prev) => ({ ...prev, [machineId]: true }));
    try {
      await fetch("/api/producoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId, placaId, quantidadePlacas }),
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
      await fetch(`/api/producoes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "concluida" }),
      });
      await carregarRapido();
      carregarDemanda();
    } finally {
      setCarregando((prev) => ({ ...prev, [machineId]: false }));
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
          Informe o quanto tem em estoque de cada cor (em gramas). Cor deixada
          em 0 bloqueia automaticamente a fila de prioridade abaixo pra todas
          as placas daquela cor — não precisa subir produto pra produção sem
          ter filamento pra imprimir. A cor de cada placa é detectada pelo
          nome (ex: &quot;Suporte Carro (Prata)&quot;); placas sem cor no
          nome (kits, produtos multicoloridos) contam como
          &quot;Colorido&quot;.
        </p>
        {filamento && <FilamentoEditor filamento={filamento} onSalvar={salvarFilamento} />}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Índice de falhas</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card
            label="Taxa de falha real"
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
          Calculado sobre tudo que já foi rodado até hoje (produções concluídas
          + placas com falha total) — não conta o que está em andamento nem o
          que foi cancelado. Placa com &quot;falha na placa&quot; conta todas
          as peças daquela placa como perdidas; produção concluída só conta as
          peças marcadas em &quot;falha em peça&quot;.
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
                  {a.titulo} {a.sku && `(SKU: ${a.sku})`} — {a.quantity}x
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
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Impressoras</h2>
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
              onIniciar={(placaId, qtd) => iniciarProducao(placaId, machine.id, qtd)}
              onConcluir={(id) => concluirProducao(id, machine.id)}
              onCancelar={(id) => cancelarProducao(id, machine.id)}
              onFalhaPlaca={(id, gramas) => falhaPlaca(id, machine.id, gramas)}
              onFalhaPeca={(id, desc, gramas) => falhaPeca(id, machine.id, desc, gramas)}
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
const LABEL_COR_FILAMENTO: Record<CorFilamento, string> = {
  colorido: "Colorido",
  preto: "Preto",
  branco: "Branco",
  prata: "Prata",
  marrom: "Marrom",
  bege: "Bege",
};

// Formulário de estoque de filamento por cor — 6 campos (um por cor
// controlada), edição local até clicar em Salvar (evita disparar um PUT a
// cada dígito digitado). Pedido do Guilherme em 2026-07-25: cor em 0
// bloqueia a fila de prioridade (ver filtro em filaPrioridade acima).
function FilamentoEditor({
  filamento,
  onSalvar,
}: {
  filamento: EstoqueFilamentoRow;
  onSalvar: (novo: EstoqueFilamentoRow) => void;
}) {
  const [valores, setValores] = useState<Record<CorFilamento, string>>(() => {
    const inicial = {} as Record<CorFilamento, string>;
    for (const cor of CORES_FILAMENTO) inicial[cor] = String(filamento[cor] ?? 0);
    return inicial;
  });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const atualizado = {} as Record<CorFilamento, string>;
    for (const cor of CORES_FILAMENTO) atualizado[cor] = String(filamento[cor] ?? 0);
    setValores(atualizado);
  }, [filamento]);

  async function salvar() {
    setSalvando(true);
    try {
      const novo = {} as EstoqueFilamentoRow;
      for (const cor of CORES_FILAMENTO) novo[cor] = Math.max(0, Number(valores[cor]) || 0);
      await onSalvar(novo);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {CORES_FILAMENTO.map((cor) => (
          <label key={cor} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-500">
              {LABEL_COR_FILAMENTO[cor]} (g)
            </span>
            <input
              type="number"
              min={0}
              value={valores[cor]}
              onChange={(e) => setValores((prev) => ({ ...prev, [cor]: e.target.value }))}
              className={
                "rounded border px-2 py-1 text-sm " +
                ((Number(valores[cor]) || 0) <= 0
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-gray-300")
              }
            />
          </label>
        ))}
      </div>
      <div>
        <button
          disabled={salvando}
          onClick={salvar}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {salvando ? "Salvando..." : "Salvar estoque de filamento"}
        </button>
      </div>
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
}: {
  machine: MachineRow;
  producao?: ProducaoRow;
  placaPorId: Map<number, PlacaRow>;
  filaPrioridade: FilaPrioridadeItem[];
  pertoDoFechamento: boolean;
  aberturaHora: number;
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
  onIniciar: (placaId: number, quantidadePlacas: number) => void;
}) {
  const [placaId, setPlacaId] = useState<number | "">(filaPrioridade[0]?.placa.id ?? "");
  const [quantidade, setQuantidade] = useState(1);
  const [buscaSku, setBuscaSku] = useState("");
  const [resultados, setResultados] = useState<SkuResult[]>([]);
  const [placaSelecionadaNome, setPlacaSelecionadaNome] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

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

  // Tempo médio de impressão da placa escolhida — pedido do Guilherme em
  // 2026-07-24: mostrar como observação na hora de carregar, pra dar uma
  // noção de quando ela deve terminar (mesmo campo tempoPlacaHoras já
  // usado no cálculo de "Qtd p/ virar a noite" da fila de prioridade).
  const placaSelecionada = placaId ? placaPorId.get(placaId) : undefined;

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
              {item.placa.nome} — a produzir: {item.aProduzirEfetivo}
              {item.emProducao > 0 ? ` (${item.emProducao} já em produção)` : ""}
            </option>
          ))}
        </select>
      </div>

      {placaSelecionadaNome && (
        <p className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-800">
          Selecionado via busca: {placaSelecionadaNome}
        </p>
      )}

      {placaSelecionada && (
        <p className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
          Tempo médio de impressão: {formatHora(placaSelecionada.tempoPlacaHoras)}
          {quantidade > 1 ? ` por placa (${quantidade}x = ${formatHora(placaSelecionada.tempoPlacaHoras * quantidade)} no total)` : ""}
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
          {carregando ? "Carregando..." : "Carregar máquina"}
        </button>
      </div>
    </div>
  );
}
