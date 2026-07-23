// Helper de data compartilhado entre Vendas (Server Component) e Produção
// (Client Component), pra evitar duas implementações divergentes.

// Data de hoje no fuso de São Paulo (UTC-3), no formato aceito pelo
// <input type="date"> e pelos filtros da API da ML (YYYY-MM-DD).
export function todaySP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function formatDiaBR(day: string): string {
  return new Date(`${day}T12:00:00-03:00`).toLocaleDateString("pt-BR");
}

// "N dias atrás" a partir de um dia (YYYY-MM-DD), fuso São Paulo. Usado
// pra montar janelas de resumo (ex: últimos 7 dias = diasAtras(hoje, 6)).
export function diasAtras(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00-03:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Primeiro dia do mês de um dia de referência (YYYY-MM-DD).
export function inicioDoMes(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

// Hora atual (0-23, com fração de minutos) no fuso de São Paulo — usada
// pela aba Produção pra saber se estamos dentro do horário de operação
// das máquinas (9h-23h) e sugerir a quantidade de placas que "vira a
// noite" sem precisar de troca manual. Baseado em epoch (Date.now()), não
// no fuso do navegador — funciona igual em qualquer lugar.
export function horaAtualSP(): number {
  const agora = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return agora.getUTCHours() + agora.getUTCMinutes() / 60;
}

// Quantas horas faltam até a próxima "abertura" (horário em que alguém
// volta a poder trocar placa nas máquinas, por padrão 9h). Se já passou
// da abertura hoje, conta até a abertura de amanhã — é esse valor que
// dimensiona a carga noturna (qtd. de placas × tempo/placa ≥ esse valor
// pra impressora não terminar e ficar parada sem ninguém pra trocar).
export function horasAteProximaAbertura(horaAbertura: number = 9): number {
  const h = horaAtualSP();
  if (h < horaAbertura) return horaAbertura - h;
  return 24 - h + horaAbertura;
}
