import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Corrige o tempo real de uma producao ja concluida (pedido do Guilherme
// em 2026-08-12: o tempo mostrado no popup pos-producao vinha do relogio
// do sistema -- iniciado_em ate agora -- que pode estar errado se a
// maquina ficou carregada sem imprimir de fato, ou se o Guilherme so
// clicou 'concluir' bem depois do fatiador ter terminado). Atualiza
// tempo_placa_horas da placa (dividido pela qtd de placas da producao),
// igual ao padrao ja usado em corrigir-filamento/route.ts pro peso.

async function garantirTabela() {
    await sql`
        CREATE TABLE IF NOT EXISTS correcoes_tempo (
              id SERIAL PRIMARY KEY,
                    producao_id INTEGER NOT NULL,
                          placa_id INTEGER NOT NULL,
                                horas_antigas NUMERIC NOT NULL,
                                      horas_novas NUMERIC NOT NULL,
                                            delta_horas NUMERIC NOT NULL,
                                                  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                                                      )
                                                        `;
    await sql`
    ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados BOOLEAN NOT NULL DEFAULT false
    `;
    await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados_a2l BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS tempo_placa_horas_a2l NUMERIC`;
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
    const horasCorretas = Number(body?.horasCorretas);
    if (!Number.isFinite(horasCorretas) || horasCorretas < 0) {
          return NextResponse.json(
            { error: "Informe horasCorretas (>= 0)." },
            { status: 400 }
                );
    }

  const producaoRows = (await sql`
      SELECT po.placa_id, po.quantidade_placas, po.status, m.nome AS machine_nome
      FROM producoes po
      JOIN machines m ON m.id = po.machine_id
      WHERE po.id = ${id}
            `) as { placa_id: number; quantidade_placas: string; status: string; machine_nome: string }[];
    if (producaoRows.length === 0) {
          return NextResponse.json(
            { error: "producao nao encontrada" },
            { status: 404 }
                );
    }
    const producao = producaoRows[0];
  const isA2L = /a2l/i.test(producao.machine_nome);
    if (producao.status !== "concluida") {
          return NextResponse.json(
            { error: "so e possivel corrigir producoes concluidas" },
            { status: 400 }
                );
    }

  const placaRows = (await sql`
      SELECT tempo_placa_horas, tempo_placa_horas_a2l FROM placas WHERE id = ${producao.placa_id}
        `) as { tempo_placa_horas: number | null; tempo_placa_horas_a2l: number | null }[];
    if (placaRows.length === 0) {
          return NextResponse.json({ error: "placa nao encontrada" }, { status: 404 });
    }
    const placa = placaRows[0];
    const quantidadePlacas = Number(producao.quantidade_placas);
    const tempoAtual = isA2L
    ? (placa.tempo_placa_horas_a2l ? Number(placa.tempo_placa_horas_a2l) : 0)
    : (placa.tempo_placa_horas ? Number(placa.tempo_placa_horas) : 0);
    const horasAntigas = quantidadePlacas * tempoAtual;
    const delta = horasCorretas - horasAntigas;

  const tempoPlacaNovo =
        quantidadePlacas > 0 ? horasCorretas / quantidadePlacas : horasCorretas;
    if (isA2L) {
    await sql`
        UPDATE placas SET tempo_placa_horas_a2l = ${tempoPlacaNovo}, dados_confirmados_a2l = true
            WHERE id = ${producao.placa_id}
              `;
  } else {
    await sql`
        UPDATE placas SET tempo_placa_horas = ${tempoPlacaNovo}, dados_confirmados = true
            WHERE id = ${producao.placa_id}
              `;
  }

  await sql`
      INSERT INTO correcoes_tempo
            (producao_id, placa_id, horas_antigas, horas_novas, delta_horas)
                VALUES (${id}, ${producao.placa_id}, ${horasAntigas}, ${horasCorretas}, ${delta})
                  `;

  return NextResponse.json({
        ok: true,
        horasNovas: horasCorretas,
        tempoPlacaNovo,
        delta,
  });
}
