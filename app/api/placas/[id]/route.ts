import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Atualiza dados editáveis de uma placa. Historicamente só o peso de
// filamento gasto (pesoPlacaGramas) era editável por aqui. Pedido do
// Guilherme em 2026-07-31: "o suporte carro tem 1 placa de corpo e 1
// placa mista com 2 corpo e 3 ganchos... quando concluído deve lançar
// estoque separado" — o campo saída extra (saida_extra_placa_id +
// saida_extra_pecas) já existe no schema desde 2026-07-24 (ver PATCH
// /api/producoes/[id]) exatamente pra isso: quando uma placa MISTA é
// concluída, além de creditar sua própria peça (papel "gancho", no caso
// do Suporte Carro) ela também credita X peças de OUTRA placa (a
// "saída extra" — no caso, a placa "corpo" da mesma cor). Só que os 3
// registros do Suporte Carro (Branco/Cinza/Preto) nunca tiveram esse
// campo preenchido — por isso a placa Corpo nunca recebia crédito
// nenhum quando só a Mista era impressa. Agora editável por aqui.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const { pesoPlacaGramas, saidaExtraPlacaId, saidaExtraPecas } = body as {
    pesoPlacaGramas?: number | null;
    saidaExtraPlacaId?: number | null;
    saidaExtraPecas?: number | null;
  };

  if (
    pesoPlacaGramas !== null &&
    pesoPlacaGramas !== undefined &&
    (!Number.isFinite(pesoPlacaGramas) || pesoPlacaGramas < 0)
  ) {
    return NextResponse.json(
      { error: "pesoPlacaGramas precisa ser um número >= 0 (ou null)" },
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
      { error: "saidaExtraPecas precisa ser um número >= 0 (ou null)" },
      { status: 400 }
    );
  }

  const temPeso = pesoPlacaGramas !== undefined;
  const temSaidaId = saidaExtraPlacaId !== undefined;
  const temSaidaPecas = saidaExtraPecas !== undefined;

  const rows = (await sql`
    UPDATE placas
    SET
      peso_placa_gramas = CASE WHEN ${temPeso} THEN ${pesoPlacaGramas ?? null} ELSE peso_placa_gramas END,
      saida_extra_placa_id = CASE WHEN ${temSaidaId} THEN ${saidaExtraPlacaId ?? null} ELSE saida_extra_placa_id END,
      saida_extra_pecas = CASE WHEN ${temSaidaPecas} THEN ${saidaExtraPecas ?? null} ELSE saida_extra_pecas END
    WHERE id = ${id}
    RETURNING id, peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas
  `) as {
    id: number;
    peso_placa_gramas: string | null;
    saida_extra_placa_id: number | null;
    saida_extra_pecas: string | null;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "placa não encontrada" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
