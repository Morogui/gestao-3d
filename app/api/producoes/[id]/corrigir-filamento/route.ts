import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { corFilamentoDaPlaca, corPetgDe, CORES_COM_PETG, CorFilamento } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Mesma logica de app/api/producoes/[id]/route.ts -- resolve qual
// entrada de estoque (cor normal ou a variante -petg) corresponde a
// producao, a partir do nome da placa + do material escolhido ao
// carregar a maquina.
function corEfetiva(
    corBase: CorFilamento | null,
    material: string | null
  ): CorFilamento | null {
    if (!corBase) return null;
    if (material === "PETG" && CORES_COM_PETG.includes(corBase)) {
          return corPetgDe(corBase);
        }
    return corBase;
  }

// Corrige o peso de filamento registrado numa producao ja concluida --
// pedido do Guilherme em 2026-08-12 ao validar o popup de resumo pos-
// producao contra o fatiador e achar pesos errados cadastrados nas
// placas. Chamada pelo botao Editar no popup.
async function garantirTabela() {
    await sql`
      CREATE TABLE IF NOT EXISTS correcoes_filamento (
              id SERIAL PRIMARY KEY,
              producao_id INTEGER NOT NULL,
              placa_id INTEGER NOT NULL,
              cor TEXT,
              gramas_antigas NUMERIC NOT NULL,
              gramas_novas NUMERIC NOT NULL,
              delta_gramas NUMERIC NOT NULL,
              criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
            )
    `;
    await sql`
    ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados BOOLEAN NOT NULL DEFAULT false
    `;
  }

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
  ) {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
          return NextResponse.json({ error: "id invalido" }, { status: 400 });
        }
    await garantirTabela();

    const body = await request.json();
    const gramasCorretas = Number(body?.gramasCorretas);
    if (!Number.isFinite(gramasCorretas) || gramasCorretas < 0) {
          return NextResponse.json(
                  { error: "Informe gramasCorretas (>= 0)." },
                  { status: 400 }
                );
        }

    const producaoRows = (await sql`
                              SELECT placa_id, quantidade_placas, material, status
                              FROM producoes WHERE id = ${id}
                            `) as {
          placa_id: number;
          quantidade_placas: string;
          material: string | null;
          status: string;
        }[];
    if (producaoRows.length === 0) {
          return NextResponse.json(
                  { error: "producao nao encontrada" },
                  { status: 404 }
                );
        }
    const producao = producaoRows[0];
    if (producao.status !== "concluida") {
          return NextResponse.json(
                  { error: "so e possivel corrigir producoes concluidas" },
                  { status: 400 }
                );
        }

    const placaRows = (await sql`
                           SELECT nome, peso_placa_gramas FROM placas WHERE id = ${producao.placa_id}
                         `) as { nome: string; peso_placa_gramas: number | null }[];
    if (placaRows.length === 0) {
          return NextResponse.json({ error: "placa nao encontrada" }, { status: 404 });
        }
    const placa = placaRows[0];
    const quantidadePlacas = Number(producao.quantidade_placas);
    const pesoAtual = placa.peso_placa_gramas ? Number(placa.peso_placa_gramas) : 0;
    const gramasAntigas = quantidadePlacas * pesoAtual;
    const delta = gramasCorretas - gramasAntigas;

    const corBase = corFilamentoDaPlaca(placa.nome);
    const cor = corEfetiva(corBase, producao.material);

    if (cor && delta !== 0) {
          await sql`
            INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
            VALUES (${cor}, 0, now())
            ON CONFLICT (cor) DO NOTHING
          `;
          await sql`
            UPDATE estoque_filamento
            SET quantidade_gramas = GREATEST(0, quantidade_gramas - ${delta}),
                atualizado_em = now()
            WHERE cor = ${cor}
          `;
        }

    const pesoPlacaNovo =
      quantidadePlacas > 0 ? gramasCorretas / quantidadePlacas : gramasCorretas;
    await sql`
      UPDATE placas SET peso_placa_gramas = ${pesoPlacaNovo}, dados_confirmados = true
      WHERE id = ${producao.placa_id}
    `;

    await sql`
      INSERT INTO correcoes_filamento
        (producao_id, placa_id, cor, gramas_antigas, gramas_novas, delta_gramas)
      VALUES (${id}, ${producao.placa_id}, ${cor}, ${gramasAntigas}, ${gramasCorretas}, ${delta})
    `;

    return NextResponse.json({
          ok: true,
          gramasNovas: gramasCorretas,
          pesoPlacaNovo,
          cor,
          delta,
        });
  }
