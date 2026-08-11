import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
// Atualiza dados editaveis de uma placa. Historicamente so o peso de
// filamento gasto (pesoPlacaGramas) era editavel por aqui. Pedido do
// Guilherme em 2026-07-31: campo saida extra (saida_extra_placa_id +
// saida_extra_pecas) ja existe no schema desde 2026-07-24 pra quando
// uma placa MISTA e concluida, alem de creditar sua propria peca, ela
// tambem credita X pecas de OUTRA placa. Agora editavel por aqui.
//
// Estendido em 2026-07-31 (papel + pecasPorPlaca editaveis).
//
// Estendido em 2026-08-11 (frasesCorrespondencia editavel) - pedido do
// Guilherme apos a aba Analise mostrar dezenas de anuncios "sem match"
// que na verdade ja estavam cadastrados. O titulo real do anuncio no
// Mercado Livre e copy de marketing, quase nunca igual ao nome/SKU
// cadastrado no catalogo. frasesCorrespondencia ja existia no schema
// (lib/placas.ts) e no motor de match (lib/demanda.ts), so faltava uma
// forma de editar sem precisar de migracao manual no banco.
export async function PATCH(
    request: NextRequest,
  { params }: { params: { id: string } }
  ) {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
          return NextResponse.json({ error: "id invalido" }, { status: 400 });
    }

  const body = await request.json();
    const {
          pesoPlacaGramas,
          saidaExtraPlacaId,
          saidaExtraPecas,
          papel,
          pecasPorPlaca,
          descontinuada,
          frasesCorrespondencia,
    } = body as {
          pesoPlacaGramas?: number | null;
          saidaExtraPlacaId?: number | null;
          saidaExtraPecas?: number | null;
          papel?: "corpo" | "gancho" | null;
          pecasPorPlaca?: number;
          descontinuada?: boolean;
          frasesCorrespondencia?: string | null;
    };

  if (
        pesoPlacaGramas !== null &&
        pesoPlacaGramas !== undefined &&
        (!Number.isFinite(pesoPlacaGramas) || pesoPlacaGramas < 0)
      ) {
        return NextResponse.json(
          { error: "pesoPlacaGramas precisa ser um numero >= 0 (ou null)" },
          { status: 400 }
              );
  }
    if (
          saidaExtraPlacaId !== null &&
          saidaExtraPlacaId !== undefined &&
          !Number.isInteger(saidaExtraPlacaId)
        ) {
          return NextResponse.json(
            { error: "saidaExtraPlacaId precisa ser um id inteiro (ou null)" },
            { status: 400 }
                );
    }
    if (
          saidaExtraPecas !== null &&
          saidaExtraPecas !== undefined &&
          (!Number.isFinite(saidaExtraPecas) || saidaExtraPecas < 0)
        ) {
          return NextResponse.json(
            { error: "saidaExtraPecas precisa ser um numero >= 0 (ou null)" },
            { status: 400 }
                );
    }
    if (papel !== undefined && papel !== null && papel !== "corpo" && papel !== "gancho") {
          return NextResponse.json(
            { error: "papel precisa ser 'corpo', 'gancho' ou null" },
            { status: 400 }
                );
    }
    if (pecasPorPlaca !== undefined && (!Number.isFinite(pecasPorPlaca) || pecasPorPlaca <= 0)) {
          return NextResponse.json(
            { error: "pecasPorPlaca precisa ser um numero > 0" },
            { status: 400 }
                );
    }

  if (descontinuada !== undefined && typeof descontinuada !== "boolean") {
        return NextResponse.json(
          { error: "descontinuada precisa ser um booleano" },
          { status: 400 }
              );
  }

  if (
        frasesCorrespondencia !== undefined &&
        frasesCorrespondencia !== null &&
        typeof frasesCorrespondencia !== "string"
      ) {
        return NextResponse.json(
          { error: "frasesCorrespondencia precisa ser uma string (ou null)" },
          { status: 400 }
              );
  }

  const temPeso = pesoPlacaGramas !== undefined;
    const temSaidaId = saidaExtraPlacaId !== undefined;
    const temSaidaPecas = saidaExtraPecas !== undefined;
    const temPapel = papel !== undefined;
    const temPecasPorPlaca = pecasPorPlaca !== undefined;
    const temDescontinuada = descontinuada !== undefined;
    const temFrases = frasesCorrespondencia !== undefined;

  const rows = (await sql`
      UPDATE placas
          SET
                peso_placa_gramas = CASE WHEN ${temPeso} THEN ${pesoPlacaGramas ?? null} ELSE peso_placa_gramas END,
                      saida_extra_placa_id = CASE WHEN ${temSaidaId} THEN ${saidaExtraPlacaId ?? null} ELSE saida_extra_placa_id END,
                            saida_extra_pecas = CASE WHEN ${temSaidaPecas} THEN ${saidaExtraPecas ?? null} ELSE saida_extra_pecas END,
                                  papel = CASE WHEN ${temPapel} THEN ${papel ?? null} ELSE papel END,
                                        pecas_por_placa = CASE WHEN ${temPecasPorPlaca} THEN ${pecasPorPlaca ?? null} ELSE pecas_por_placa END,
                                              descontinuada = CASE WHEN ${temDescontinuada} THEN ${descontinuada ?? false} ELSE descontinuada END,
                                                    frases_correspondencia = CASE WHEN ${temFrases} THEN ${frasesCorrespondencia ?? null} ELSE frases_correspondencia END
                                                        WHERE id = ${id}
                                                            RETURNING id, peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas, papel, pecas_por_placa, descontinuada, frases_correspondencia
                                                              `) as {
        id: number;
        peso_placa_gramas: string | null;
        saida_extra_placa_id: number | null;
        saida_extra_pecas: string | null;
        papel: string | null;
        pecas_por_placa: string;
        descontinuada: boolean;
        frases_correspondencia: string | null;
  }[];

  if (rows.length === 0) {
        return NextResponse.json({ error: "placa nao encontrada" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
