import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-07-26). O Guilherme confirmou (com
// screenshot do fatiamento no slicer) uma nova placa "Suporte Universal -
// Mista": no mesmo tempo/peso da placa "Corpos" (275,09g / 7h53m total),
// sai 3 corpos + 2 ganchos por impressao, em vez de so 3 corpos. As
// placas "Corpos-so" (id 4/51) e "Ganchos-so" (id 5/52, 10 ganchos)
// continuam existindo do jeito que estao - a Mista e uma TERCEIRA opcao
// de placa pro operador escolher na hora de carregar a maquina.
//
// Mesmo padrao ja usado em "Suporte Carro - Mista" (ver
// docs/logica-producao-placas.md e app/api/producoes/[id]/route.ts):
// papel='gancho' + pecas_por_placa=2 (seu proprio papel) e
// saida_extra_placa_id apontando pra placa de Corpos correspondente com
// saida_extra_pecas=3 (credita o corpo extra la quando a producao
// conclui). O gancho proprio da Mista NAO entra no pool compartilhado
// (ver lib/placas.ts) - "cada um tem o seu", so a placa Ganchos-so avulsa
// e compartilhada entre Universal/BMW/BYD.
//
// Idempotente: usa nome como chave de "ja existe" (nao insere de novo se
// ja rodou antes).
const NUMERO_INICIAL = 200; // bem acima do maior numero existente, so pra nao colidir

interface NovaPlaca {
    nome: string;
    grupoComposto: string;
    skuOuKit: string;
    saidaExtraNomeReferencia: string; // nome da placa "Corpos" correspondente, pra achar o id dela
}

const NOVAS: NovaPlaca[] = [
  {
        nome: "Suporte Universal - Mista (Branco)",
        grupoComposto: "Universal",
        skuOuKit: "SUPORTE UNIVERSAL BRANCO",
        saidaExtraNomeReferencia: "Suporte Universal - Corpos (Branco)",
  },
  {
        nome: "Suporte Universal - Mista (Preto)",
        grupoComposto: "Universal-Preto",
        skuOuKit: "SUPORTE UNIVERSAL PRETO",
        saidaExtraNomeReferencia: "Suporte Universal - Corpos (Preto)",
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

      const corpoRows = (await sql`
            SELECT id FROM placas WHERE nome = ${nova.saidaExtraNomeReferencia}
                `) as { id: number }[];
        if (corpoRows.length === 0) {
                return NextResponse.json(
                  {
                              error: `Placa de referencia "${nova.saidaExtraNomeReferencia}" nao encontrada - abortando sem criar nada.`,
                  },
                  { status: 400 }
                        );
        }
        const corpoPlacaId = corpoRows[0].id;

      const inserida = (await sql`
            INSERT INTO placas (
                    numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
                            pecas_por_placa, tempo_placa_horas, tier, descontinuada,
                                    peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas
                                          ) VALUES (
                                                  ${proximoNumero}, ${nova.nome}, 'composto', 'gancho', ${nova.grupoComposto}, ${nova.skuOuKit},
                                                          2, 7.883, 'A', false,
                                                                  275.09, ${corpoPlacaId}, 3
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
