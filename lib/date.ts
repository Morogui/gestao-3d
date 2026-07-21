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
