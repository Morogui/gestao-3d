import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import {
  corFilamentoDaPlaca,
  corPetgDe,
  CORES_COM_PETG,
  labelCorFilamento,
} from "@/lib/placas";

export const dynamic = "force-dynamic";

// Lista as produções em andamento e as concluídas mais recentes (últimas
// 50), já com o nome da máquina e da placa pra exibir na tela sem round
// trips extras.
export async function GET() {
  await garantirColunas();
  const rows = await sql`
    SELECT
      pr.id, pr.machine_id, pr.placa_id, pr.quantidade_placas, pr.status,
      pr.iniciado_em, pr.concluido_em, pr.gramas_desperdicadas, pr.material,
      pr.pecas_por_placa_usada, pr.ganchos_por_placa_usada,
      m.nome AS machine_nome,
      pl.nome AS placa_nome, pl.pecas_por_placa,
      COALESCE(fp.count, 0) AS falhas_peca_count
    FROM producoes pr
    JOIN machines m ON m.id = pr.machine_id
    JOIN placas pl ON pl.id = pr.placa_id
    LEFT JOIN (
      SELECT producao_id, count(*) AS count FROM falhas_peca GROUP BY producao_id
    ) fp ON fp.producao_id = pr.id
    ORDER BY
      CASE WHEN pr.status = 'em_andamento' THEN 0 ELSE 1 END,
      pr.iniciado_em DESC
    LIMIT 50
  `;
  return NextResponse.json(rows);
}

// Coluna adicionada em 2026-07-29 — pedido do Guilherme: "Nos filamentos,
// temos que adicionar a opcao de Petg na cor preto, branco, vermelho...
// na hora da producao perguntar em qual material esta usando". Guarda
// qual material o operador escolheu ao carregar a máquina (só tem
// sentido pras 3 cores com opção PETG — ver CORES_COM_PETG em
// lib/placas.ts); null = PLA (comportamento de sempre pras demais
// cores/produções antigas).
//
// pecas_por_placa_usada adicionada em 2026-08-31 — pedido do Guilherme:
// a impressora A2L cabe uma quantidade DIFERENTE de peças por placa do
// que as outras impressoras (mesma placa/design, mesa menor). O
// cadastro de placas.pecas_por_placa é um valor ÚNICO e global (usado
// por todas as impressoras) — sobrescrevê-lo a partir de uma produção
// da A2L quebraria a conta das demais impressoras. Em vez disso, essa
// coluna guarda um SNAPSHOT da quantidade real informada pelo operador
// NA HORA de carregar essa produção específica (só perguntado/editável
// no formulário quando a máquina é a A2L — ver CarregarPlacaForm em
// app/producao/page.tsx); null = usa o valor padrão da placa (todas as
// outras impressoras, comportamento de sempre).
async function garantirColunas() {
  await sql`ALTER TABLE producoes ADD COLUMN IF NOT EXISTS material TEXT`;
  await sql`ALTER TABLE producoes ADD COLUMN IF NOT EXISTS pecas_por_placa_usada NUMERIC`;
  await sql`ALTER TABLE producoes ADD COLUMN IF NOT EXISTS ganchos_por_placa_usada NUMERIC`;
}

// Inicia uma nova produção (carregar uma placa em uma máquina).
export async function POST(request: NextRequest) {
  await garantirColunas();

  const body = await request.json();
  const { machineId, placaId, quantidadePlacas, material, pecasPorPlacaUsada, ganchosPorPlacaUsada } = body as {
    machineId: number;
    placaId: number;
    quantidadePlacas: number;
    material?: "PLA" | "PETG";
    pecasPorPlacaUsada?: number | null;
    ganchosPorPlacaUsada?: number | null;
  };

  if (!machineId || !placaId || !quantidadePlacas || quantidadePlacas <= 0) {
    return NextResponse.json(
      { error: "machineId, placaId e quantidadePlacas (> 0) são obrigatórios" },
      { status: 400 }
    );
  }

  if (
    pecasPorPlacaUsada !== null &&
    pecasPorPlacaUsada !== undefined &&
    (!Number.isFinite(pecasPorPlacaUsada) || pecasPorPlacaUsada < 0)
  ) {
    return NextResponse.json(
      { error: "pecasPorPlacaUsada precisa ser um número >= 0 (ou null)" },
      { status: 400 }
    );
  }

  // ganchos_por_placa_usada — pedido do Guilherme em 2026-09-01: placas
  // mistas (corpo + gancho) geram DOIS produtos por impressão, e a A2L
  // cabe uma proporção diferente de ganchos por placa que as outras
  // impressoras. Esse campo é o análogo, pro lado do "gancho" (saída
  // extra), do pecasPorPlacaUsada acima (que cobre o "corpo" principal).
  if (
    ganchosPorPlacaUsada !== null &&
    ganchosPorPlacaUsada !== undefined &&
    (!Number.isFinite(ganchosPorPlacaUsada) || ganchosPorPlacaUsada < 0)
  ) {
    return NextResponse.json(
      { error: "ganchosPorPlacaUsada precisa ser um número >= 0 (ou null)" },
      { status: 400 }
    );
  }

  const materialNormalizado = material === "PETG" ? "PETG" : null;
  // Trava de seguranca - pedido do Guilherme em 2026-08-21: bloquear
  // carregamento de producao quando o estoque de filamento da cor+material
  // escolhido estiver zerado (corFilamentoDaPlaca usa a mesma logica ja
  // aplicada na fila de prioridade). Cores nao identificaveis no nome ou
  // "colorido" (multicor) nunca sao bloqueadas.
  const placaRows = await sql`SELECT nome FROM placas WHERE id = ${placaId}`;
  const nomePlaca = placaRows[0]?.nome as string | undefined;
  if (nomePlaca) {
    const cor = corFilamentoDaPlaca(nomePlaca);
    if (cor && cor !== "colorido") {
      const corParaChecar =
        materialNormalizado === "PETG" && (CORES_COM_PETG as readonly string[]).includes(cor)
          ? corPetgDe(cor)
          : cor;
      const estoqueRows = await sql`
        SELECT quantidade_gramas FROM estoque_filamento WHERE cor = ${corParaChecar}
      `;
      const gramas = Number(estoqueRows[0]?.quantidade_gramas ?? 0);
      if (gramas <= 0) {
        return NextResponse.json(
          {
            error: `Estoque de filamento ${labelCorFilamento(corParaChecar)} zerado - nao e possivel carregar essa producao.`,
          },
          { status: 400 }
        );
      }
    }
  }

  const rows = await sql`
    INSERT INTO producoes (machine_id, placa_id, quantidade_placas, status, material, pecas_por_placa_usada, ganchos_por_placa_usada)
    VALUES (${machineId}, ${placaId}, ${quantidadePlacas}, 'em_andamento', ${materialNormalizado}, ${pecasPorPlacaUsada ?? null}, ${ganchosPorPlacaUsada ?? null})
    RETURNING id, machine_id, placa_id, quantidade_placas, status, iniciado_em, concluido_em, material, pecas_por_placa_usada, ganchos_por_placa_usada
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
