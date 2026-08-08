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
//
// Estendido em 2026-07-31 (papel + pecasPorPlaca editáveis) — pedido do
// Guilherme: "BMW, universal e BYD utilizam o mesmo gancho... quando for
// produzido o gancho, ele pode servir tanto pro BMW quanto pro Universal
// quanto pro BYD... quando a gente faz a produção da placa mista, a
// gente deve separar os corpos para os produtos... e os ganchos
// armazenar no mesmo estoque". A placa "Suporte Universal - Mista" tinha
// papel="gancho" (crédito PRÓPRIO = gancho, ficando numa gaveta separada
// só dela) e saída extra apontando pro corpo do Universal — mas o gancho
// tem que cair no pool compartilhado (Gancho Compartilhado), não numa
// gaveta exclusiva do Universal. Como só existe 1 slot de "saída extra"
// por placa, a correção é inverter os papéis: crédito PRÓPRIO passa a
// ser o corpo (papel="corpo", soma com a placa "Corpos" dedicada — o
// código já soma múltiplas placas do mesmo papel num grupo) e a saída
// extra passa a apontar pro Gancho Compartilhado da cor certa.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const {
    pesoPlacaGramas,
    saidaExtraPlacaId,
    saidaExtraPecas,
    papel,
    pecasPorPlaca,
    descontinuada,
  } = body as {
    pesoPlacaGramas?: number | null;
    saidaExtraPlacaId?: number | null;
    saidaExtraPecas?: number | null;
    papel?: "corpo" | "gancho" | null;
    pecasPorPlaca?: number;
    descontinuada?: boolean;
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
  if (papel !== undefined && papel !== null && papel !== "corpo" && papel !== "gancho") {
    return NextResponse.json(
      { error: "papel precisa ser 'corpo', 'gancho' ou null" },
      { status: 400 }
    );
  }
  if (pecasPorPlaca !== undefined && (!Number.isFinite(pecasPorPlaca) || pecasPorPlaca <= 0)) {
    return NextResponse.json(
      { error: "pecasPorPlaca precisa ser um número > 0" },
      { status: 400 }
    );
  }

  if (descontinuada !== undefined && typeof descontinuada !== "boolean") {
    return NextResponse.json(
      { error: "descontinuada precisa ser um booleano" },
      { status: 400 }
    );
  }

  const temPeso = pesoPlacaGramas !== undefined;
  const temSaidaId = saidaExtraPlacaId !== undefined;
  const temSaidaPecas = saidaExtraPecas !== undefined;
  const temPapel = papel !== undefined;
  const temPecasPorPlaca = pecasPorPlaca !== undefined;
  const temDescontinuada = descontinuada !== undefined;

  const rows = (await sql`
    UPDATE placas
    SET
      peso_placa_gramas = CASE WHEN ${temPeso} THEN ${pesoPlacaGramas ?? null} ELSE peso_placa_gramas END,
      saida_extra_placa_id = CASE WHEN ${temSaidaId} THEN ${saidaExtraPlacaId ?? null} ELSE saida_extra_placa_id END,
      saida_extra_pecas = CASE WHEN ${temSaidaPecas} THEN ${saidaExtraPecas ?? null} ELSE saida_extra_pecas END,
      papel = CASE WHEN ${temPapel} THEN ${papel ?? null} ELSE papel END,
      pecas_por_placa = CASE WHEN ${temPecasPorPlaca} THEN ${pecasPorPlaca ?? null} ELSE pecas_por_placa END,
      descontinuada = CASE WHEN ${temDescontinuada} THEN ${descontinuada ?? false} ELSE descontinuada END
    WHERE id = ${id}
    RETURNING id, peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas, papel, pecas_por_placa, descontinuada
  `) as {
    id: number;
    peso_placa_gramas: string | null;
    saida_extra_placa_id: number | null;
    saida_extra_pecas: string | null;
    papel: string | null;
    pecas_por_placa: string;
    descontinuada: boolean;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "placa não encontrada" }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
