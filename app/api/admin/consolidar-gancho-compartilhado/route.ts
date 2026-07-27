import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (2026-07-26). O Guilherme confirmou (com
// screenshot do fatiamento) que o gancho do Suporte Universal, do
// Suporte BMW e do Suporte Carregador BYD é a MESMA peça física — uma
// placa só de gancho abastece os três produtos ao mesmo tempo. A placa
// Mista de cada um continua sendo só dele ("cada um tem o seu"); só a
// placa de gancho AVULSA (Ganchos-só) vira compartilhada. Suporte Carro
// fica de fora (usa gancho próprio, só via a própria Mista dele).
//
// O que essa rota faz, por cor (Branco/Preto):
//  1. Cria uma placa nova "Gancho Compartilhado (Cor)" com
//     grupoComposto = pool interno usado por lib/placas.ts::estoqueVendavel
//     (GANCHO_COMPARTILHADO_POR_GRUPO), estoque inicial = SOMA do estoque
//     das 3 placas de gancho antigas (não perde peça nenhuma), e
//     frases_correspondencia cobrindo os títulos/SKUs dos 3 produtos —
//     assim uma venda de qualquer um dos três continua descontando o
//     pool compartilhado certinho.
//  2. Descontinua as 3 placas de gancho antigas (Universal/BMW/BYD) e
//     LIMPA o texto de casamento delas (sku_ou_kit vira um texto que não
//     bate com nada + frases_correspondencia = null) — sem isso, a venda
//     bateria DUAS vezes (na placa antiga E na nova compartilhada) e
//     descontaria em dobro. Zera o estoque delas também (já foi somado
//     na placa nova).
//
// Idempotente: se a placa "Gancho Compartilhado (Cor)" já existe, pula
// aquela cor inteira (não soma de novo, não mexe nas antigas de novo).
const PESO_GRAMAS = 122.65;
const TEMPO_HORAS = 3.75; // 3h45m (tempo total do fatiamento)
const PECAS_POR_PLACA = 10;

interface Config {
  cor: "Branco" | "Preto";
  grupoCompartilhado: string;
  skuOuKit: string;
  frasesCorrespondencia: string;
  nomesAntigos: string[];
}

const CONFIGS: Config[] = [
  {
    cor: "Branco",
    grupoCompartilhado: "__gancho_compartilhado_branco__",
    skuOuKit: "GANCHO COMPARTILHADO (UNIVERSAL/BMW/BYD) BRANCO",
    frasesCorrespondencia: [
      "SUPORTE UNIVERSAL BRANCO",
      "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal",
      "SUPORTE BMW BRANCO",
      "Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw",
      "SUPORTE CARREGADOR BYD BRANCO",
    ].join(" | "),
    nomesAntigos: [
      "Suporte Universal - Ganchos (Branco)",
      "Suporte BMW - Ganchos (Branco)",
      "Suporte Carregador BYD - Ganchos (Branco)",
    ],
  },
  {
    cor: "Preto",
    grupoCompartilhado: "__gancho_compartilhado_preto__",
    skuOuKit: "GANCHO COMPARTILHADO (UNIVERSAL/BMW/BYD) PRETO",
    frasesCorrespondencia: [
      "SUPORTE UNIVERSAL PRETO",
      "Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal Preto",
      "SUPORTE BMW PRETO",
      "Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw",
      "SUPORTE CARREGADOR BYD PRETO",
    ].join(" | "),
    nomesAntigos: [
      "Suporte Universal - Ganchos (Preto)",
      "Suporte BMW - Ganchos (Preto)",
      "Suporte Carregador BYD - Ganchos (Preto)",
    ],
  },
];

export async function POST() {
  try {
    return await executar();
  } catch (err) {
    // Devolve o erro real em JSON em vez de deixar a função cair com
    // resposta vazia (500 sem corpo) — mais fácil de depurar via fetch().
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

async function executar() {
  const resultado: Record<string, unknown> = {};

  const maxNumeroRows = (await sql`
    SELECT COALESCE(MAX(numero), 0) AS max FROM placas
  `) as { max: number }[];
  let proximoNumero = Math.max(300, Number(maxNumeroRows[0].max) + 1);

  for (const cfg of CONFIGS) {
    const nomeNovo = `Gancho Compartilhado - Universal/BMW/BYD (${cfg.cor})`;

    const jaExiste = (await sql`
      SELECT id FROM placas WHERE nome = ${nomeNovo}
    `) as { id: number }[];
    if (jaExiste.length > 0) {
      resultado[cfg.cor] = { skip: true, motivo: "já existe", id: jaExiste[0].id };
      continue;
    }

    // Busca cada placa antiga individualmente por nome (em vez de usar
    // WHERE nome = ANY(array) com um array de textos) — mais simples e
    // evita qualquer problema de inferência de tipo do array no driver.
    const antigas: { id: number; nome: string; estoque: number | null }[] = [];
    for (const nomeAntigo of cfg.nomesAntigos) {
      const rows = (await sql`
        SELECT placas.id AS id, placas.nome AS nome, estoque_placas.quantidade_pecas AS estoque
        FROM placas
        LEFT JOIN estoque_placas ON estoque_placas.placa_id = placas.id
        WHERE placas.nome = ${nomeAntigo}
      `) as { id: number; nome: string; estoque: number | null }[];
      antigas.push(...rows);
    }

    const somaEstoque = antigas.reduce((acc, p) => acc + Number(p.estoque ?? 0), 0);

    const inserida = (await sql`
      INSERT INTO placas (
        numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
        frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
        descontinuada, peso_placa_gramas
      ) VALUES (
        ${proximoNumero}, ${nomeNovo}, 'composto', 'gancho', ${cfg.grupoCompartilhado},
        ${cfg.skuOuKit}, ${cfg.frasesCorrespondencia}, ${PECAS_POR_PLACA},
        ${TEMPO_HORAS}, 'A', false, ${PESO_GRAMAS}
      )
      RETURNING id, nome
    `) as { id: number; nome: string }[];
    proximoNumero += 1;

    await sql`
      INSERT INTO estoque_placas (placa_id, quantidade_pecas)
      VALUES (${inserida[0].id}, ${somaEstoque})
      ON CONFLICT (placa_id) DO UPDATE SET quantidade_pecas = ${somaEstoque}
    `;

    // Descontinua e limpa o casamento de texto das placas antigas —
    // sem isso a venda bateria duas vezes (antiga + nova compartilhada).
    for (const antiga of antigas) {
      await sql`
        UPDATE placas
        SET descontinuada = true,
            sku_ou_kit = ${"GANCHO ANTIGO (SUBSTITUÍDO) - " + antiga.nome},
            frases_correspondencia = NULL
        WHERE id = ${antiga.id}
      `;
      await sql`
        UPDATE estoque_placas SET quantidade_pecas = 0, atualizado_em = now()
        WHERE placa_id = ${antiga.id}
      `;
    }

    resultado[cfg.cor] = {
      criada: inserida[0],
      estoqueTransferido: somaEstoque,
      antigasDescontinuadas: antigas.map((a) => ({ id: a.id, nome: a.nome, estoqueAnterior: a.estoque })),
    };
  }

  return NextResponse.json({ ok: true, resultado });
}
