import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-07-26). O Guilherme confirmou (com
// screenshot do fatiamento) que o gancho do Suporte Universal, do
// Suporte BMW e do Suporte Carregador BYD e a MESMA peca fisica - uma
// placa so de gancho abastece os tres produtos ao mesmo tempo. A placa
// Mista de cada um continua sendo so dele ("cada um tem o seu"); so a
// placa de gancho AVULSA (Ganchos-so) vira compartilhada. Suporte Carro
// fica de fora (usa gancho proprio, so via a propria Mista dele).
//
// O que essa rota faz, por cor (Branco/Preto):
//  1. Cria uma placa nova "Gancho Compartilhado (Cor)" com
//     grupoComposto = pool interno usado por lib/placas.ts::estoqueVendavel
//     (GANCHO_COMPARTILHADO_POR_GRUPO), estoque inicial = SOMA do estoque
//     das 3 placas de gancho antigas (nao perde peca nenhuma), e
//     frases_correspondencia cobrindo os titulos/SKUs dos 3 produtos -
//     assim uma venda de qualquer um dos tres continua descontando o
//     pool compartilhado certinho.
//  2. Descontinua as 3 placas de gancho antigas (Universal/BMW/BYD) e
//     LIMPA o texto de casamento delas (sku_ou_kit vira um texto que nao
//     bate com nada + frases_correspondencia = null) - sem isso, a venda
//     bateria DUAS vezes (na placa antiga E na nova compartilhada) e
//     descontaria em dobro. Zera o estoque delas tambem (ja foi somado
//     na placa nova).
//
// Idempotente: se a placa "Gancho Compartilhado (Cor)" ja existe, pula
// aquela cor inteira (nao soma de novo, nao mexe nas antigas de novo).
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
                resultado[cfg.cor] = { skip: true, motivo: "ja existe", id: jaExiste[0].id };
                continue;
        }

      const antigas = (await sql`
            SELECT id, nome, estoque_placas.quantidade_pecas AS estoque
                  FROM placas
                        LEFT JOIN estoque_placas ON estoque_placas.placa_id = placas.id
                              WHERE placas.nome = ANY(${cfg.nomesAntigos})
                                  `) as { id: number; nome: string; estoque: number | null }[];

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

      for (const antiga of antigas) {
              await sql`
                      UPDATE placas
                              SET descontinuada = true,
                                          sku_ou_kit = ${"GANCHO ANTIGO (SUBSTITUIDO) - " + antiga.nome},
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
