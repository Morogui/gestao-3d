import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const PADRAO_ABERTURA = 9;
const PADRAO_FECHAMENTO = 23;
const MIN_AMOSTRAS = 5;

export interface JanelaResult {
  aberturaHora: number;
  fechamentoHora: number;
  amostras: number;
  // false enquanto não há carregamentos suficientes pra confiar no
  // aprendizado — nesse caso a janela usada é o padrão fixo (9h-23h).
  aprendido: boolean;
}

// Aprende o horário real de operação (abertura/fechamento das máquinas)
// a partir de QUANDO as placas de fato foram carregadas (iniciado_em de
// cada produção) — em vez de fixar 9h-23h à mão pra sempre, o sistema se
// ajusta sozinho conforme a rotina real do Guilherme muda (pedido dele:
// "faça essa produção ir aprendendo com os horários que as placas são
// colocadas, pra ficar automatizado").
//
// Usa os últimos 200 carregamentos (todas as produções não canceladas).
// Corta os 5% mais extremos de cada ponta antes de pegar min/max — assim
// uma troca isolada de madrugada (por qualquer motivo excepcional) não
// puxa a janela inteira. Com poucos dados (< 5 carregamentos), cai pro
// padrão 9h-23h em vez de aprender de uma amostra pequena demais.
export async function GET() {
  const rows = (await sql`
    SELECT iniciado_em FROM producoes
    WHERE status != 'cancelada'
    ORDER BY iniciado_em DESC
    LIMIT 200
  `) as { iniciado_em: string }[];

  if (rows.length < MIN_AMOSTRAS) {
    const resultado: JanelaResult = {
      aberturaHora: PADRAO_ABERTURA,
      fechamentoHora: PADRAO_FECHAMENTO,
      amostras: rows.length,
      aprendido: false,
    };
    return NextResponse.json(resultado);
  }

  // Hora do dia (0-23, com fração de minutos) de cada carregamento, no
  // fuso de São Paulo — mesma conta usada em lib/date.ts::horaAtualSP().
  const horas = rows
    .map((r) => {
      const d = new Date(new Date(r.iniciado_em).getTime() - 3 * 60 * 60 * 1000);
      return d.getUTCHours() + d.getUTCMinutes() / 60;
    })
    .sort((a, b) => a - b);

  const corte = Math.max(0, Math.floor(horas.length * 0.05));
  const aberturaHora = horas[corte];
  const fechamentoHora = horas[horas.length - 1 - corte];

  const resultado: JanelaResult = {
    aberturaHora: Math.round(aberturaHora * 10) / 10,
    fechamentoHora: Math.round(fechamentoHora * 10) / 10,
    amostras: horas.length,
    aprendido: true,
  };
  return NextResponse.json(resultado);
}
