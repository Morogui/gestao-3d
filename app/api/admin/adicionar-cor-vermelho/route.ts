import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-29). Pedido do Guilherme: "Falta
// adicionar a cor vermelho, que o suporte garrafa coracao e o love
// utiliza ele para ser feito." Essas duas placas ("Suporte para Garrafa
// Coracao" e "Love decorativo") não tinham cor nenhuma no nome — por
// isso corFilamentoDaPlaca() (lib/placas.ts) caía no fallback
// "colorido", quando na verdade são impressas em filamento vermelho.
// Mesmo padrão da convenção "Nome (Cor)" usada em todo o catálogo —
// renomeia pra incluir "(Vermelho)" no nome, o que faz
// corFilamentoDaPlaca() detectar o token "vermelho" automaticamente
// (já adicionado em CORES_FILAMENTO e CORES_CONHECIDAS_NO_NOME).
// Idempotente: usa o nome atual como chave de busca, não faz nada se já
// foi renomeado antes (ou se a placa não existe).
const RENOMEACOES = [
  { de: "Suporte para Garrafa Coracao", para: "Suporte para Garrafa Coracao (Vermelho)" },
  { de: "Love decorativo", para: "Love decorativo (Vermelho)" },
];

export async function POST() {
  const renomeadas: { id: number; de: string; para: string }[] = [];
  const jaEstavam: { id: number; nome: string }[] = [];
  const naoEncontradas: string[] = [];

  for (const r of RENOMEACOES) {
    const jaRenomeada = (await sql`
      SELECT id, nome FROM placas WHERE nome = ${r.para}
    `) as { id: number; nome: string }[];
    if (jaRenomeada.length > 0) {
      jaEstavam.push(jaRenomeada[0]);
      continue;
    }

    const atual = (await sql`
      SELECT id, nome FROM placas WHERE nome = ${r.de}
    `) as { id: number; nome: string }[];
    if (atual.length === 0) {
      naoEncontradas.push(r.de);
      continue;
    }

    await sql`
      UPDATE placas SET nome = ${r.para} WHERE id = ${atual[0].id}
    `;
    renomeadas.push({ id: atual[0].id, de: r.de, para: r.para });
  }

  return NextResponse.json({ ok: true, renomeadas, jaEstavam, naoEncontradas });
}
