import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-31). Pedido do Guilherme: no "buscar
// SKU" da aba Produção, buscando "bmw" só aparecia "Suporte BMW - Corpos"
// e a "Gancho Compartilhado" — faltava a placa "Mista" (confirmado pelo
// Guilherme que ela existe de verdade na impressora: "mista 3 corpo e 2
// ganchos, como te passei"). Mesma ideia da "Suporte Universal - Mista"
// (ver criar-suporte-universal-mista/route.ts), só que já nascendo com a
// arquitetura CERTA desde o início (painel finalizar-consolidacao-gancho
// + placas/[id] PATCH em 2026-07-31): crédito PRÓPRIO da placa = corpo
// (papel='corpo', pecas_por_placa=3 — soma com a placa "Corpos" dedicada
// do BMW no mesmo grupoComposto) e a saída extra credita 2 ganchos no
// Gancho Compartilhado (Universal/BMW/BYD) da cor certa — não numa gaveta
// exclusiva do BMW, já que o gancho é físico e fisicamente idêntico entre
// BMW/Universal/BYD.
//
// Peso/tempo: Guilherme não passou um valor separado pra placa Mista —
// usando o mesmo peso/tempo já cadastrado na "Suporte BMW - Corpos"
// (309,2g / 7h), mesmo padrão usado quando a Mista do Universal foi
// criada (275,09g ~ igual aos 275,1g da Corpos do Universal). Se o peso
// real da Mista for diferente (ela imprime 2 ganchos a mais que a
// Corpos-só), é só editar depois via PATCH /api/placas/[id].
//
// Idempotente: usa nome como chave de "já existe".
const NUMERO_INICIAL = 400;

interface NovaPlaca {
  nome: string;
  grupoComposto: string;
  skuOuKit: string;
  poolGanchoId: number; // placa do Gancho Compartilhado da cor certa
  pesoPlacaGramas: number;
  tempoPlacaHoras: number;
}

const NOVAS: NovaPlaca[] = [
  {
    nome: "Suporte BMW - Mista (Branco)",
    grupoComposto: "BMW",
    skuOuKit: "SUPORTE BMW BRANCO",
    poolGanchoId: 82,
    pesoPlacaGramas: 309.2,
    tempoPlacaHoras: 7,
  },
  {
    nome: "Suporte BMW - Mista (Preto)",
    grupoComposto: "BMW-Preto",
    skuOuKit: "SUPORTE BMW PRETO",
    poolGanchoId: 83,
    pesoPlacaGramas: 309.2,
    tempoPlacaHoras: 7,
  },
];

export async function POST() {
  const criadas: { id: number; nome: string }[] = [];
  const jaExistiam: { id: number; nome: string }[] = [];

  const maxNumeroRows = (await sql`
    SELECT COALESCE(MAX(numero), 0) AS max FROM placas
  `) as { max: number }[];
  let proximoNumero = Math.max(NUMERO_INICIAL, Number(maxNumeroRows[0].max) + 1);

  for (const nova of NOVAS) {
    const existente = (await sql`
      SELECT id, nome FROM placas WHERE nome = ${nova.nome}
    `) as { id: number; nome: string }[];
    if (existente.length > 0) {
      jaExistiam.push(existente[0]);
      continue;
    }

    const poolRows = (await sql`
      SELECT id FROM placas WHERE id = ${nova.poolGanchoId}
    `) as { id: number }[];
    if (poolRows.length === 0) {
      return NextResponse.json(
        { error: `Placa do pool de gancho (id ${nova.poolGanchoId}) não encontrada — abortando sem criar nada.` },
        { status: 400 }
      );
    }

    const inserida = (await sql`
      INSERT INTO placas (
        numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
        pecas_por_placa, tempo_placa_horas, tier, descontinuada,
        peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas
      ) VALUES (
        ${proximoNumero}, ${nova.nome}, 'composto', 'corpo', ${nova.grupoComposto}, ${nova.skuOuKit},
        3, ${nova.tempoPlacaHoras}, 'C', false,
        ${nova.pesoPlacaGramas}, ${nova.poolGanchoId}, 2
      )
      RETURNING id, nome
    `) as { id: number; nome: string }[];

    await sql`
      INSERT INTO estoque_placas (placa_id, quantidade_pecas)
      VALUES (${inserida[0].id}, 0)
      ON CONFLICT (placa_id) DO NOTHING
    `;

    criadas.push(inserida[0]);
    proximoNumero += 1;
  }

  return NextResponse.json({ ok: true, criadas, jaExistiam });
}
