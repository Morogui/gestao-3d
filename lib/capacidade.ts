// Checagem de viabilidade de produção pra envios planejados do Full —
// pedido do Guilherme em 2026-07-29: "quando eu colocar as skus e a data
// que eu quero enviar, deve conferir a possibilidade para produção sem
// comprometer mais de 50% da minha linha de produção, caso não
// comprometa, podemos aprovar esse produto para envio".
//
// Ideia: cada envio pendente já tem faltantePlaca (peças que ainda
// faltam produzir — ver GET /api/full/envios). Convertendo isso em HORAS
// de impressora (via tempoPlacaHoras/pecasPorPlaca da placa) e comparando
// contra a capacidade teórica total das máquinas ativas entre HOJE e a
// data limite do envio, dá pra saber se esse envio sozinho tomaria mais
// de 50% de tudo que a linha consegue produzir nesse período — o que
// deixaria pouco espaço pra reposição normal do estoque local/demanda do
// dia a dia. Se ficar em 50% ou menos, o envio é "aprovado" (viável sem
// sacrificar a produção normal); acima disso, vira alerta de risco pro
// Guilherme decidir manualmente (ex: adiar a data, dividir o envio,
// ou aceitar mesmo assim).
//
// Simplificação assumida (mesmo espírito de outras contas do sistema,
// ex: a fila de prioridade): usa a capacidade TEÓRICA total (todas as
// máquinas ativas × janela de operação aprendida × dias disponíveis),
// sem descontar o que já está reservado por OUTRAS produções em
// andamento ou outros envios — é uma estimativa de "quanto isso pesa no
// total", não uma simulação completa de agenda.
import { sql } from "./db";

const PADRAO_ABERTURA = 9;
const PADRAO_FECHAMENTO = 23;
const MIN_AMOSTRAS = 5;

export interface Janela {
  aberturaHora: number;
  fechamentoHora: number;
}

// Mesmo cálculo de /api/producao/janela (aprende o horário real de
// operação a partir de quando as placas foram carregadas) — duplicado
// aqui de propósito, mesmo padrão de pequenas duplicações já aceito no
// projeto (ex: corEfetiva em app/api/producoes/[id]/route.ts e
// app/api/producao/filamento/historico/route.ts), pra não criar uma
// dependência cruzada entre a rota de produção e essa checagem de Full.
export async function janelaAprendida(): Promise<Janela> {
  const rows = (await sql`
    SELECT iniciado_em FROM producoes
    WHERE status != 'cancelada'
    ORDER BY iniciado_em DESC
    LIMIT 200
  `) as { iniciado_em: string }[];

  if (rows.length < MIN_AMOSTRAS) {
    return { aberturaHora: PADRAO_ABERTURA, fechamentoHora: PADRAO_FECHAMENTO };
  }

  const horas = rows
    .map((r) => {
      const d = new Date(new Date(r.iniciado_em).getTime() - 3 * 60 * 60 * 1000);
      return d.getUTCHours() + d.getUTCMinutes() / 60;
    })
    .sort((a, b) => a - b);

  const corte = Math.max(0, Math.floor(horas.length * 0.05));
  return {
    aberturaHora: Math.round(horas[corte] * 10) / 10,
    fechamentoHora: Math.round(horas[horas.length - 1 - corte] * 10) / 10,
  };
}

export async function maquinasAtivas(): Promise<number> {
  const rows = (await sql`
    SELECT count(*)::int AS total FROM machines WHERE ativa = true
  `) as { total: number }[];
  const total = rows[0]?.total ?? 0;
  // Regra do Guilherme em 2026-08-14: sempre reservar 1 impressora
  // de folga no calculo de capacidade (hoje sao 5 ativas, usamos 4;
  // se um dia forem 6, passa a usar 5 sozinho, sem precisar mexer
  // em nenhum outro lugar do codigo).
  return Math.max(0, total - 1);
}

// Dias entre "hoje" e "alvo" (ambos YYYY-MM-DD, fuso São Paulo),
// INCLUSIVE dos dois extremos — hoje conta como 1 dia disponível mesmo
// que já tenha passado parte do expediente. Se o alvo já passou (envio
// atrasado), retorna 0 — sem dias de capacidade sobrando.
export function diasDisponiveisAte(hoje: string, alvo: string): number {
  const dHoje = new Date(`${hoje}T12:00:00-03:00`);
  const dAlvo = new Date(`${alvo}T12:00:00-03:00`);
  const diff = Math.round((dAlvo.getTime() - dHoje.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff + 1);
}

export interface ViabilidadeEnvio {
  horasNecessarias: number;
  capacidadeDisponivelHoras: number;
  // Fração de 0 a 1 (ou mais, se exceder 100%) de quanto desse envio
  // ocupa da capacidade teórica total disponível até a data limite.
  percentualComprometido: number;
  // Viável sem comprometer mais de 50% da linha de produção no período.
  aprovado: boolean;
}

// faltantePecas: quanto ainda falta produzir (peças) — 0 ou negativo
// significa já coberto por estoque/produção em andamento, então nem
// precisa de horas de máquina (sempre aprovado, percentual 0).
export function calcularViabilidade(
  faltantePecas: number,
  pecasPorPlaca: number,
  tempoPlacaHoras: number,
  hoje: string,
  dataLimite: string,
  numMaquinasAtivas: number,
  janela: Janela
): ViabilidadeEnvio {
  if (faltantePecas <= 0) {
    return {
      horasNecessarias: 0,
      capacidadeDisponivelHoras: 0,
      percentualComprometido: 0,
      aprovado: true,
    };
  }

  const placasNecessarias =
    pecasPorPlaca > 0 ? Math.ceil(faltantePecas / pecasPorPlaca) : 0;
  const horasNecessarias = placasNecessarias * (tempoPlacaHoras || 0);

  const dias = diasDisponiveisAte(hoje, dataLimite);
  const horasPorDia = Math.max(0, janela.fechamentoHora - janela.aberturaHora);
  const capacidadeDisponivelHoras = numMaquinasAtivas * horasPorDia * dias;

  const percentualComprometido =
    capacidadeDisponivelHoras > 0
      ? horasNecessarias / capacidadeDisponivelHoras
      : horasNecessarias > 0
      ? Infinity
      : 0;

  return {
    horasNecessarias,
    capacidadeDisponivelHoras,
    percentualComprometido,
    aprovado: percentualComprometido <= 0.5,
  };


export function dataMinimaViavel(
    horasNecessarias: number,
    hoje: string,
    numMaquinasAtivas: number,
    janela: Janela
  ): string | null {
    const horasPorDia = Math.max(0, janela.fechamentoHora - janela.aberturaHora);
    const horasPorDiaTotal = numMaquinasAtivas * horasPorDia;
    if (horasNecessarias <= 0) return hoje;
    if (horasPorDiaTotal <= 0) return null;
    const diasNecessarios = Math.ceil(horasNecessarias / horasPorDiaTotal);
    const d = new Date(`${hoje}T12:00:00-03:00`);
    d.setDate(d.getDate() + (diasNecessarios - 1));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dia}`;
}
  
  }
