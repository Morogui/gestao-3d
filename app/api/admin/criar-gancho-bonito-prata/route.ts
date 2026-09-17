import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Rota administrativa de execucao unica - pedido do Guilherme em
  // 2026-09-17: "O gancho bonito tem a placa prata, branco e preto. E a
  // mesma, mesma placa, porem eu so mudo a cor no fatiador. Entao tem que
  // ter tres placas, uma de cada cor, para elas poderem sair no kit uma
  // unidade gancho bonito, kit unidade com dois ganchos bonitos e com tres
  // ganchos bonitos."
  //
  // Hoje existem placas-mae corretas pra Branco (id 27) e Preto (id 63),
  // ambas com 13 pecas/placa e 3.967h/placa - mas NENHUMA placa-mae pra
  // Prata. Em vez disso existem 9 placas bugadas (117-125), criadas
  // diretamente a partir do nome da SKU de venda (ex: "KIT 2 GANCHOS
      // BONITO - PRATA"), uma por combinacao cor x tamanho de kit, todas com
    // 1 peca/placa e estoque 0 - sao SKUs de venda confundidas com placas
    // fisicas, nao placas reais (mesmo bug ja corrigido no caso do 6X3).
      //
      // Esta rota:
      // 1) Cria a placa-mae "Ganchos Bonito (Prata)", clonando os dados fisicos
      //    reais de Branco/Preto (mesma peca, so muda a cor).
      // 2) Aposenta (descontinuada=true) as 9 placas bugadas 117-125, nas 3
      //    cores - mesmo tratamento ja aplicado as duplicatas do 6X3.
        export async function POST() {
            try {
                const jaExiste = await sql`
            SELECT id FROM placas WHERE nome = 'Ganchos Bonito (Prata)' LIMIT 1
                `;
                let novaPlacaId: number;

            if (jaExiste.length > 0) {
              novaPlacaId = jaExiste[0].id;
              } else {
                    const proximoNumero = await sql`
              SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM placas
                    `;
              const numero = proximoNumero[0].proximo;

                    const inserida = await sql`
                      INSERT INTO placas (
                          numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
                          frases_correspondencia, pecas_por_placa, tempo_placa_horas,
                          tier, descontinuada, peso_placa_gramas, dados_confirmados
              ) VALUES (
                ${numero}, 'Ganchos Bonito (Prata)', 'direta', NULL, NULL,
                          'KIT 1/2/3 GANCHOS BONITO PRATA', NULL, 13, 3.967, 'C', false,
                          154.1, false
              )
                      RETURNING id
                    `;
              novaPlacaId = inserida[0].id;

                    await sql`
              INSERT INTO estoque_placas (placa_id, quantidade_pecas)
              VALUES (${novaPlacaId}, 0)
              ON CONFLICT (placa_id) DO NOTHING
                    `;
            }

            const idsBogus = [117, 118, 119, 120, 121, 122, 123, 124, 125];
                await sql`
            UPDATE placas SET descontinuada = true WHERE id = ANY(${idsBogus})
                `;

                const confirmNova = await sql`
                  SELECT id, numero, nome, pecas_por_placa, tempo_placa_horas,
                         peso_placa_gramas, tier, descontinuada
            FROM placas WHERE id = ${novaPlacaId}
                `;
                const confirmBogus = await sql`
            SELECT id, nome, descontinuada FROM placas WHERE id = ANY(${idsBogus})
                  ORDER BY id
                `;

                return NextResponse.json({
                      ok: true,
                placaCriada: confirmNova[0],
                      placasAposentadas: confirmBogus,
                });
            } catch (error) {
                return NextResponse.json(
              { ok: false, error: String(error) },
              { status: 500 }
            );
          }
        }
        
