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
