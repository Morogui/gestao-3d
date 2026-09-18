import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ProdutoInput, PlacaComponenteInput, parseSkus } from "@/lib/custo";

export const dynamic = "force-dynamic";

type ProdutoRow = {
  id: number;
  nome: string;
  sku: string | null;
  nome_placa: string | null;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
  pecas_na_placa_a2l: string | null;
  peso_placa_a2l_g: string | null;
  tempo_placa_a2l_h: string | null;
  pecas_por_unidade: string | null;
};

function toProdutoInput(row: ProdutoRow): ProdutoInput {
  return {
    id: String(row.id),
    nome: row.nome,
    sku: row.sku ?? "",
    nomePlaca: row.nome_placa ?? null,
    pesoPlacaG: Number(row.peso_placa_g),
    tempoPlacaH: Number(row.tempo_placa_h),
    pecasNaPlaca: Number(row.pecas_na_placa),
    pecasNaPlacaA2l:
      row.pecas_na_placa_a2l === null || row.pecas_na_placa_a2l === undefined
        ? null
        : Number(row.pecas_na_placa_a2l),
    pesoPlacaA2lG:
      row.peso_placa_a2l_g === null || row.peso_placa_a2l_g === undefined
        ? null
        : Number(row.peso_placa_a2l_g),
    tempoPlacaA2lH:
      row.tempo_placa_a2l_h === null || row.tempo_placa_a2l_h === undefined
        ? null
        : Number(row.tempo_placa_a2l_h),
    pecasPorUnidade:
      row.pecas_por_unidade === null || row.pecas_por_unidade === undefined
        ? 1
        : Number(row.pecas_por_unidade),
  };
}

// Ver app/api/produtos/route.ts pra contexto completo do porque disto
// existe — mantem a placa de producao sincronizada com a edicao feita
// aqui na aba Custo, e cria a placa retroativamente (backfill) se esse
// produto foi cadastrado antes desse vinculo automatico existir (caso
// real: "Regua Bolo 5x10"/"3x10", cadastrados so no Custo, com peso e
// tempo ja preenchidos — a primeira edicao depois deste deploy cria a
// placa correspondente automaticamente, usando esses mesmos dados).
async function garantirColunas() {
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS placa_id integer REFERENCES placas(id)`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pecas_na_placa_a2l NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS nome_placa TEXT`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS peso_placa_a2l_g NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tempo_placa_a2l_h NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pecas_por_unidade NUMERIC NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS dados_confirmados_a2l BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS pecas_por_placa_a2l NUMERIC`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS tempo_placa_horas_a2l NUMERIC`;
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS peso_placa_gramas_a2l NUMERIC`;
}

async function proximoNumeroPlaca(): Promise<number> {
  const [{ proximo }] = (await sql`
    SELECT COALESCE(MAX(numero), 0) + 1 AS proximo FROM placas
  `) as { proximo: number }[];
  return proximo;
}

async function criarPlaca(params: {
  nome: string;
  skuOuKit: string | null;
  pesoPlacaG: number;
  tempoPlacaH: number;
  pecasNaPlaca: number;
  pesoPlacaA2lG?: number | null;
  tempoPlacaA2lH?: number | null;
  pecasNaPlacaA2l?: number | null;
}): Promise<number> {
  const {
    nome,
    skuOuKit,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
    pesoPlacaA2lG,
    tempoPlacaA2lH,
    pecasNaPlacaA2l,
  } = params;
  const numero = await proximoNumeroPlaca();
  const dadosConfirmadosA2l = Boolean(
    tempoPlacaA2lH || pecasNaPlacaA2l || pesoPlacaA2lG
  );
  const [placa] = (await sql`
    INSERT INTO placas (
      numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
      frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
      descontinuada, peso_placa_gramas, dados_confirmados,
      pecas_por_placa_a2l, tempo_placa_horas_a2l, peso_placa_gramas_a2l,
      dados_confirmados_a2l
    )
    VALUES (
      ${numero}, ${nome}, 'direta', null, null, ${skuOuKit || nome},
      null, ${pecasNaPlaca}, ${tempoPlacaH}, 'C',
      false, ${pesoPlacaG}, true,
      ${pecasNaPlacaA2l || null}, ${tempoPlacaA2lH || null}, ${pesoPlacaA2lG || null},
      ${dadosConfirmadosA2l}
    )
    RETURNING id
  `) as { id: number }[];
  return placa.id;
}

async function atualizarPlaca(params: {
  placaId: number;
  nome: string;
  skuOuKit: string | null;
  pesoPlacaG: number;
  tempoPlacaH: number;
  pecasNaPlaca: number;
  pesoPlacaA2lG?: number | null;
  tempoPlacaA2lH?: number | null;
  pecasNaPlacaA2l?: number | null;
}) {
  const {
    placaId,
    nome,
    skuOuKit,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
    pesoPlacaA2lG,
    tempoPlacaA2lH,
    pecasNaPlacaA2l,
  } = params;
  const dadosConfirmadosA2l = Boolean(
    tempoPlacaA2lH || pecasNaPlacaA2l || pesoPlacaA2lG
  );
  await sql`
    UPDATE placas
    SET nome = ${nome},
        sku_ou_kit = ${skuOuKit || nome},
        pecas_por_placa = ${pecasNaPlaca},
        tempo_placa_horas = ${tempoPlacaH},
        peso_placa_gramas = ${pesoPlacaG},
        pecas_por_placa_a2l = ${pecasNaPlacaA2l || null},
        tempo_placa_horas_a2l = ${tempoPlacaA2lH || null},
        peso_placa_gramas_a2l = ${pesoPlacaA2lG || null},
        dados_confirmados_a2l = ${dadosConfirmadosA2l}
    WHERE id = ${placaId}
  `;
}

async function vincularSku(sku: string, placaId: number, pecasPorUnidade: number) {
  const existente = await sql`
    SELECT 1 FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placaId}
  `;
  if (existente.length > 0) {
    await sql`
      UPDATE sku_placa SET pecas_por_unidade = ${pecasPorUnidade}
      WHERE sku = ${sku} AND placa_id = ${placaId}
    `;
  } else {
    await sql`
      INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
      VALUES (${sku}, ${placaId}, ${pecasPorUnidade})
    `;
  }
}

async function desvincularSku(sku: string, placaId: number) {
  await sql`DELETE FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placaId}`;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const body = await request.json();
  const {
    nome,
    sku,
    nomePlaca,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
    pecasNaPlacaA2l,
    pesoPlacaA2lG,
    tempoPlacaA2lH,
    pecasPorUnidade,
    placasAdicionais,
  } = body as Omit<ProdutoInput, "id">;

  await garantirColunas();

  const antigoRows = (await sql`
    SELECT sku, placa_id FROM produtos WHERE id = ${id}
  `) as { sku: string | null; placa_id: number | null }[];
  if (antigoRows.length === 0) {
    return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  }
  const skuAntigo = antigoRows[0].sku;
  const placaIdPrincipalAntigo = antigoRows[0].placa_id;

  const skuListAntigo = parseSkus(skuAntigo);
  const skuListNovo = parseSkus(sku);
  const pecasPorUnidadePrincipal = pecasPorUnidade || 1;

  // Todas as placas (principal + componentes) já vinculadas a QUALQUER
  // um dos SKUs antigos deste produto — usado pra saber o que existia
  // antes da edição e poder desfazer vínculos que não fazem mais
  // sentido depois de salvar.
  const antigoPlacaIds = new Set<number>();
  if (skuListAntigo.length > 0) {
    const linhas = (await sql`
      SELECT DISTINCT placa_id FROM sku_placa WHERE sku = ANY(${skuListAntigo})
    `) as { placa_id: number }[];
    for (const l of linhas) antigoPlacaIds.add(l.placa_id);
  }
  if (placaIdPrincipalAntigo) antigoPlacaIds.add(placaIdPrincipalAntigo);

  const rows = (await sql`
    UPDATE produtos
    SET nome = ${nome},
        sku = ${sku || null},
        nome_placa = ${nomePlaca || null},
        peso_placa_g = ${pesoPlacaG},
        tempo_placa_h = ${tempoPlacaH},
        pecas_na_placa = ${pecasNaPlaca},
        pecas_na_placa_a2l = ${pecasNaPlacaA2l || null},
        peso_placa_a2l_g = ${pesoPlacaA2lG || null},
        tempo_placa_a2l_h = ${tempoPlacaA2lH || null},
        pecas_por_unidade = ${pecasPorUnidadePrincipal}
    WHERE id = ${id}
    RETURNING id, nome, sku, nome_placa, peso_placa_g, tempo_placa_h, pecas_na_placa,
              pecas_na_placa_a2l, peso_placa_a2l_g, tempo_placa_a2l_h, pecas_por_unidade
  `) as ProdutoRow[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "produto não encontrado" }, { status: 404 });
  }

  // Placa principal: atualiza se já existir, cria (backfill) se este
  // produto for de antes do vínculo automático existir.
  let placaIdPrincipal = placaIdPrincipalAntigo;
  if (placaIdPrincipal) {
    await atualizarPlaca({
      placaId: placaIdPrincipal,
      nome: nomePlaca || nome,
      skuOuKit: skuListNovo[0] || sku || null,
      pesoPlacaG,
      tempoPlacaH,
      pecasNaPlaca,
      pesoPlacaA2lG,
      tempoPlacaA2lH,
      pecasNaPlacaA2l,
    });
  } else {
    placaIdPrincipal = await criarPlaca({
      nome: nomePlaca || nome,
      skuOuKit: skuListNovo[0] || sku || null,
      pesoPlacaG,
      tempoPlacaH,
      pecasNaPlaca,
      pesoPlacaA2lG,
      tempoPlacaA2lH,
      pecasNaPlacaA2l,
    });
    await sql`UPDATE produtos SET placa_id = ${placaIdPrincipal} WHERE id = ${id}`;
  }

  // Reconcilia as placas adicionais: as que já têm placaId são
  // atualizadas no lugar; as sem placaId (novas linhas do "+ Nova
  // placa") são criadas agora.
  const componentePlacaIdsFinal = new Set<number>();
  const placasAdicionaisSalvas: PlacaComponenteInput[] = [];
  for (const componente of placasAdicionais ?? []) {
    if (!componente.nome || !componente.nome.trim()) continue;
    let placaId = componente.placaId ?? null;
    if (placaId) {
      await atualizarPlaca({
        placaId,
        nome: componente.nome,
        skuOuKit: skuListNovo[0] || sku || null,
        pesoPlacaG: componente.pesoPlacaG,
        tempoPlacaH: componente.tempoPlacaH,
        pecasNaPlaca: componente.pecasNaPlaca,
        pesoPlacaA2lG: componente.pesoPlacaA2lG,
        tempoPlacaA2lH: componente.tempoPlacaA2lH,
        pecasNaPlacaA2l: componente.pecasNaPlacaA2l,
      });
    } else {
      placaId = await criarPlaca({
        nome: componente.nome,
        skuOuKit: skuListNovo[0] || sku || null,
        pesoPlacaG: componente.pesoPlacaG,
        tempoPlacaH: componente.tempoPlacaH,
        pecasNaPlaca: componente.pecasNaPlaca,
        pesoPlacaA2lG: componente.pesoPlacaA2lG,
        tempoPlacaA2lH: componente.tempoPlacaA2lH,
        pecasNaPlacaA2l: componente.pecasNaPlacaA2l,
      });
    }
    componentePlacaIdsFinal.add(placaId);
    placasAdicionaisSalvas.push({ ...componente, placaId });
  }

  // Conjunto desejado de vínculos (sku, placaId) após esta edição —
  // cada SKU atual aponta pra placa principal + todas as componentes
  // que sobraram no formulário, cada uma com sua própria quantidade por
  // unidade.
  const desejado = new Map<string, number>(); // chave "sku||placaId" -> pecasPorUnidade
  for (const s of skuListNovo) {
    desejado.set(`${s}||${placaIdPrincipal}`, pecasPorUnidadePrincipal);
    for (const componente of placasAdicionaisSalvas) {
      if (!componente.placaId) continue;
      desejado.set(
        `${s}||${componente.placaId}`,
        componente.pecasPorUnidade || 1
      );
    }
  }

  // Conjunto anterior (sku, placaId) — todos os SKUs antigos ligados a
  // todas as placas (principal + componentes) que este produto tinha
  // antes da edição.
  const anterior = new Set<string>();
  for (const s of skuListAntigo) {
    for (const placaId of antigoPlacaIds) {
      anterior.add(`${s}||${placaId}`);
    }
  }

  for (const [chave, pecas] of desejado) {
    if (!anterior.has(chave)) {
      const [s, placaIdStr] = chave.split("||");
      await vincularSku(s, Number(placaIdStr), pecas);
    } else {
      // já existia — garante que a quantidade está atualizada.
      const [s, placaIdStr] = chave.split("||");
      await vincularSku(s, Number(placaIdStr), pecas);
    }
  }
  for (const chave of anterior) {
    if (!desejado.has(chave)) {
      const [s, placaIdStr] = chave.split("||");
      await desvincularSku(s, Number(placaIdStr));
    }
  }

  const produtoAtualizado = toProdutoInput(rows[0]);
  produtoAtualizado.placaId = placaIdPrincipal;
  if (placasAdicionaisSalvas.length > 0) {
    produtoAtualizado.placasAdicionais = placasAdicionaisSalvas;
  }

  return NextResponse.json(produtoAtualizado);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  await sql`DELETE FROM produtos WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
