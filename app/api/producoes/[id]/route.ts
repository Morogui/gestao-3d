import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { corFilamentoDaPlaca, corPetgDe, CORES_COM_PETG, CorFilamento } from "@/lib/placas";

export const dynamic = "force-dynamic";

// Coluna adicionada em 2026-07-29 — ver mesma nota em
// /api/producoes/route.ts.
async function garantirColunaMaterial() {
  await sql`ALTER TABLE producoes ADD COLUMN IF NOT EXISTS material TEXT`;
}

// Resolve qual entrada de estoque (cor "normal" ou a variante "-petg")
// deve ser descontada, a partir da cor que o NOME da placa indica +
// do material que o operador escolheu ao carregar a máquina
// (producoes.material). Pedido do Guilherme em 2026-07-29: PETG só
// existe pras 3 cores em CORES_COM_PETG — pra qualquer outra cor (ou
// quando material não é "PETG"), comporta-se exatamente como antes.
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

// Desconta gramas do estoque de filamento (por cor) — pedido do
// Guilherme em 2026-07-27: "toda sku vendida tem cor... quando for
// produzida, dar baixa do meu estoque de filamento por cor". Mesmo
// padrão de upsert-e-desconta já usado em /api/producao/perda-filamento.
// Null-safe: se a placa não tiver uma cor controlada em estoque (ex:
// cinza, laranja — corFilamentoDaPlaca retorna null pra essas) ou não
// tiver gramas pra descontar, não faz nada.
async function descontarFilamento(cor: string | null, gramas: number) {
  if (!cor || !Number.isFinite(gramas) || gramas <= 0) return;
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
}

// Marca uma produção como concluída (credita o estoque da placa) ou
// cancelada (não credita nada). É aqui que a peça "sai da impressora e
// entra no estoque".
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  await garantirColunaMaterial();

  const body = await request.json();
  const { status, gramasDesperdicadas } = body as {
    status: "concluida" | "cancelada" | "falha_placa";
    gramasDesperdicadas?: number;
  };

  if (status === "cancelada") {
    await sql`
      UPDATE producoes SET status = 'cancelada'
      WHERE id = ${id} AND status = 'em_andamento'
    `;
    return NextResponse.json({ ok: true });
  }

  // Falha na placa inteira: encerra a produção sem creditar nada no
  // estoque, e registra quantos gramas de filamento foram perdidos.
  if (status === "falha_placa") {
    const rows = (await sql`
      UPDATE producoes
      SET status = 'falha_placa', concluido_em = now(),
          gramas_desperdicadas = ${gramasDesperdicadas ?? 0}
      WHERE id = ${id} AND status = 'em_andamento'
      RETURNING id, placa_id, material
    `) as { id: number; placa_id: number; material: string | null }[];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "produção não encontrada ou já encerrada" },
        { status: 404 }
      );
    }

    // Baixa do estoque de filamento por cor — 2026-07-27: numa falha de
    // placa inteira o gasto real é o que o operador informou em
    // gramasDesperdicadas (pode ser menor que o peso total da placa, se
    // a impressão falhou no meio do caminho). 2026-07-29: usa a variante
    // PETG do estoque se foi o material escolhido ao carregar a máquina.
    if (gramasDesperdicadas && gramasDesperdicadas > 0) {
      const placaRows = (await sql`
        SELECT nome FROM placas WHERE id = ${rows[0].placa_id}
      `) as { nome: string }[];
      const corBase = placaRows[0] ? corFilamentoDaPlaca(placaRows[0].nome) : null;
      const cor = corEfetiva(corBase, rows[0].material);
      await descontarFilamento(cor, gramasDesperdicadas);
    }

    return NextResponse.json({ ok: true });
  }

  if (status === "concluida") {
    const rows = (await sql`
      UPDATE producoes
      SET status = 'concluida', concluido_em = now()
      WHERE id = ${id} AND status = 'em_andamento'
      RETURNING placa_id, quantidade_placas, material
    `) as { placa_id: number; quantidade_placas: string; material: string | null }[];

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "produção não encontrada ou já concluída" },
        { status: 404 }
      );
    }

    const { placa_id: placaId, quantidade_placas: quantidadePlacas, material } = rows[0];
    const placaRows = (await sql`
      SELECT nome, pecas_por_placa, saida_extra_placa_id, saida_extra_pecas, peso_placa_gramas
      FROM placas WHERE id = ${placaId}
    `) as {
      nome: string;
      pecas_por_placa: string;
      saida_extra_placa_id: number | null;
      saida_extra_pecas: string | null;
      peso_placa_gramas: string | null;
    }[];
    const pecasPorPlaca = Number(placaRows[0]?.pecas_por_placa ?? 0);
    const saidaExtraPlacaId = placaRows[0]?.saida_extra_placa_id ?? null;
    const saidaExtraPecas = placaRows[0]?.saida_extra_pecas
      ? Number(placaRows[0].saida_extra_pecas)
      : 0;
    const pesoPlacaGramas = placaRows[0]?.peso_placa_gramas
      ? Number(placaRows[0].peso_placa_gramas)
      : null;

    // Peças perdidas em falhas pontuais (a impressão continuou, só essas
    // peças específicas foram descartadas) são descontadas do total
    // creditado no estoque.
    const falhaRows = (await sql`
      SELECT count(*)::int AS total FROM falhas_peca WHERE producao_id = ${id}
    `) as { total: number }[];
    const pecasComFalha = falhaRows[0]?.total ?? 0;

    const pecasProduzidas = Math.max(
      0,
      Number(quantidadePlacas) * pecasPorPlaca - pecasComFalha
    );

    await sql`
      UPDATE estoque_placas
      SET quantidade_pecas = quantidade_pecas + ${pecasProduzidas}, atualizado_em = now()
      WHERE placa_id = ${placaId}
    `;

    // Placa "mista" (ex: Suporte Carro - Mista): cada impressão também
    // rende peças de uma OUTRA placa (saida_extra_placa_id), além da
    // sua própria. Credita esse extra também — sem descontar falhas
    // pontuais aqui, porque falhas_peca não distingue qual tipo de peça
    // (do papel principal ou da saída extra) foi perdida na placa mista;
    // simplificação aceitável dado o baixo volume desse caso (pedido
    // 2026-07-24).
    let pecasExtraProduzidas = 0;
    if (saidaExtraPlacaId && saidaExtraPecas > 0) {
      pecasExtraProduzidas = Number(quantidadePlacas) * saidaExtraPecas;
      await sql`
        UPDATE estoque_placas
        SET quantidade_pecas = quantidade_pecas + ${pecasExtraProduzidas}, atualizado_em = now()
        WHERE placa_id = ${saidaExtraPlacaId}
      `;
    }

    // Baixa do estoque de filamento por cor — pedido do Guilherme em
    // 2026-07-27: "toda sku vendida tem cor... quando for produzida, dar
    // baixa do meu estoque de filamento por cor". Usa o peso da PLACA
    // (não da peça) × quantidade de placas impressas — o peso gasto na
    // impressora não muda se uma peça específica depois é rejeitada por
    // falha (falhas_peca), então não descontamos pecasComFalha aqui.
    let gramasFilamentoDescontadas = 0;
    if (pesoPlacaGramas) {
      gramasFilamentoDescontadas = Number(quantidadePlacas) * pesoPlacaGramas;
      const corBase = corFilamentoDaPlaca(placaRows[0].nome);
      const cor = corEfetiva(corBase, material);
      await descontarFilamento(cor, gramasFilamentoDescontadas);
    }

    return NextResponse.json({
      ok: true,
      pecasProduzidas,
      pecasComFalha,
      pecasExtraProduzidas,
      gramasFilamentoDescontadas,
    });
  }

  return NextResponse.json({ error: "status inválido" }, { status: 400 });
}
