import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { CORES_FILAMENTO, CorFilamento } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Registro de perda AVULSA de filamento - pedido do Guilherme em
// 2026-07-26: "coloque um campo onde eu consiga adicionar perda a
// parte caso eu queira", e depois "precisa alimentar qual o filamento
// que teve perda, cor do filamento". Diferente da perda ja rastreada
// automaticamente em falha_placa/falhas_peca (essa e sempre amarrada a
// uma producao especifica que falhou) - aqui e pra cobrir qualquer
// outra perda que nao veio de uma producao rastreada no sistema (ex:
// purga/limpeza de bico, teste de calibracao, filamento que quebrou/
// emaranhou no carretel, sobra descartada etc.). Ao registrar:
// 1) desconta na hora do estoque_filamento daquela cor (mesma tabela
//    usada pelo card "Estoque de filamento por cor"), ja que esse
//    filamento nao esta mais disponivel pra imprimir;
// 2) fica registrado aqui pra somar no card "Total ja desperdicado" (ver
//    /api/producao/consumo) com rastreabilidade (cor + motivo + data).
async function garantirTabela() {
      await sql`
          CREATE TABLE IF NOT EXISTS perdas_filamento_manual (
                id SERIAL PRIMARY KEY,
                      cor TEXT NOT NULL,
                            gramas INTEGER NOT NULL,
                                  motivo TEXT,
                                        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                                            )
                                              `;
}

export async function GET() {
      await garantirTabela();
      const rows = (await sql`
          SELECT id, cor, gramas, motivo, criado_em
              FROM perdas_filamento_manual
                  ORDER BY criado_em DESC
                      LIMIT 20
                        `) as { id: number; cor: string; gramas: number; motivo: string | null; criado_em: string }[];
      return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
      await garantirTabela();

  const body = await request.json();
      const cor = String(body.cor ?? "").toLowerCase() as CorFilamento;
      const gramas = Number(body.gramas);
      const motivo = body.motivo ? String(body.motivo).trim().slice(0, 200) : null;

  if (!CORES_FILAMENTO.includes(cor)) {
          return NextResponse.json(
              { error: `Cor invalida. Use uma de: ${CORES_FILAMENTO.join(", ")}.` },
              { status: 400 }
                  );
  }
      if (!Number.isFinite(gramas) || gramas <= 0) {
              return NextResponse.json({ error: "Informe gramas (> 0)." }, { status: 400 });
      }

  const registro = (await sql`
      INSERT INTO perdas_filamento_manual (cor, gramas, motivo)
          VALUES (${cor}, ${gramas}, ${motivo})
              RETURNING id, cor, gramas, motivo, criado_em
                `) as { id: number; cor: string; gramas: number; motivo: string | null; criado_em: string }[];

  // Desconta do estoque atual dessa cor (upsert - cobre o caso raro de
  // ainda nao existir linha pra essa cor em estoque_filamento).
  await sql`
      INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
          VALUES (${cor}, 0, now())
              ON CONFLICT (cor) DO NOTHING
                `;
      await sql`
          UPDATE estoque_filamento
              SET quantidade_gramas = GREATEST(0, quantidade_gramas - ${gramas}), atualizado_em = now()
                  WHERE cor = ${cor}
                    `;

  const estoqueRows = (await sql`
      SELECT cor, quantidade_gramas FROM estoque_filamento
        `) as { cor: string; quantidade_gramas: string }[];
      const porCor = new Map(estoqueRows.map((r) => [r.cor, Number(r.quantidade_gramas)]));
      const estoque = {} as Record<CorFilamento, number>;
      for (const c of CORES_FILAMENTO) estoque[c] = porCor.get(c) ?? 0;

  return NextResponse.json({ registro: registro[0], estoque }, { status: 201 });
}
