import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lista as produções em andamento e as concluídas mais recentes (últimas
// 50), já com o nome da máquina e da placa pra exibir na tela sem round
// trips extras.
export async function GET() {
  await garantirColunaMaterial();
  const rows = await sql`
    SELECT
      pr.id, pr.machine_id, pr.placa_id, pr.quantidade_placas, pr.status,
      pr.iniciado_em, pr.concluido_em, pr.gramas_desperdicadas, pr.material,
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
async function garantirColunaMaterial() {
  await sql`ALTER TABLE producoes ADD COLUMN IF NOT EXISTS material TEXT`;
}

// Inicia uma nova produção (carregar uma placa em uma máquina).
export async function POST(request: NextRequest) {
  await garantirColunaMaterial();

  const body = await request.json();
  const { machineId, placaId, quantidadePlacas, material } = body as {
    machineId: number;
    placaId: number;
    quantidadePlacas: number;
    material?: "PLA" | "PETG";
  };

  if (!machineId || !placaId || !quantidadePlacas || quantidadePlacas <= 0) {
    return NextResponse.json(
      { error: "machineId, placaId e quantidadePlacas (> 0) são obrigatórios" },
      { status: 400 }
    );
  }

  const materialNormalizado = material === "PETG" ? "PETG" : null;

  const rows = await sql`
    INSERT INTO producoes (machine_id, placa_id, quantidade_placas, status, material)
    VALUES (${machineId}, ${placaId}, ${quantidadePlacas}, 'em_andamento', ${materialNormalizado})
    RETURNING id, machine_id, placa_id, quantidade_placas, status, iniciado_em, concluido_em, material
  `;

  return NextResponse.json(rows[0], { status: 201 });
}
