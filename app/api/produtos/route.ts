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
  placa_id: number | null;
  pecas_na_placa_a2l: string | null;
  peso_placa_a2l_g: string | null;
  tempo_placa_a2l_h: string | null;
  pecas_por_unidade: string | null;
};

type ComponenteRow = {
  sku: string;
  placa_id: number;
  nome: string;
  peso_placa_gramas: string | null;
  tempo_placa_horas: string | null;
  peso_placa_gramas_a2l: string | null;
  tempo_placa_horas_a2l: string | null;
  pecas_por_placa: string | null;
  pecas_por_placa_a2l: string | null;
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
    placaId: row.placa_id,
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

function componenteParaInput(row: ComponenteRow): PlacaComponenteInput {
  return {
    placaId: row.placa_id,
    nome: row.nome,
    pesoPlacaG: row.peso_placa_gramas ? Number(row.peso_placa_gramas) : 0,
    tempoPlacaH: row.tempo_placa_horas ? Number(row.tempo_placa_horas) : 0,
    pesoPlacaA2lG: row.peso_placa_gramas_a2l ? Number(row.peso_placa_gramas_a2l) : null,
    tempoPlacaA2lH: row.tempo_placa_horas_a2l ? Number(row.tempo_placa_horas_a2l) : null,
    pecasNaPlaca: row.pecas_por_placa ? Number(row.pecas_por_placa) : 0,
    pecasNaPlacaA2l: row.pecas_por_placa_a2l ? Number(row.pecas_por_placa_a2l) : null,
    pecasPorUnidade: row.pecas_por_unidade ? Number(row.pecas_por_unidade) : 1,
  };
}

// Pedido do Guilherme em 2026-08-18: "sempre que cadastrado um produto
// novo, deve ser vinculado sempre de forma automatico pela SKU do
// produto cadastrado" — ate aqui, "produtos" (aba Custo, so pra
// calculadora de custo) e "placas" (catalogo real de producao, usado
// pelo casamento de vendas em lib/demanda.ts) eram tabelas totalmente
// separadas: cadastrar um produto na aba Custo nunca criava a placa
// correspondente, entao a venda desse produto nunca batia com nada
// (bug real reportado: "Regua Bolo 5x10" cadastrado no Custo, com peso
// e tempo preenchidos, nunca apareceu em Producao). Esta funcao cria a
// placa (+ o mapeamento sku_placa) automaticamente a partir dos dados
// que o Guilherme ja preenche na aba Custo — sem cadastro duplicado.
//
// Extensao de 2026-09-18: produtos compostos (ex: "Suporte Papel
// Toalha" = placa Base + placa Lateral, cada uma com sua propria
// peso/tempo/pecas em A1 e A2L, e SKUs de cor que podem atender mais de
// uma variacao ao mesmo tempo) precisam criar VARIAS placas + varios
// vinculos sku_placa a partir de um unico "Novo produto" na aba Custo,
// em vez de so uma. Ver lib/custo.ts (ProdutoInput.placasAdicionais)
// pro formato que o formulario envia.
async function garantirColunas() {
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS placa_id integer REFERENCES placas(id)`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pecas_na_placa_a2l NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS nome_placa TEXT`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS peso_placa_a2l_g NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS tempo_placa_a2l_h NUMERIC`;
  await sql`ALTER TABLE produtos ADD COLUMN IF NOT EXISTS pecas_por_unidade NUMERIC NOT NULL DEFAULT 1`;
  // Mesmas colunas A2L que a aba Produção já garante em
  // app/api/placas/route.ts — precisamos delas aqui também porque esta
  // rota escreve direto na tabela placas ao criar a(s) placa(s) do
  // produto.
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

export async function GET() {
  await garantirColunas();
  const rows = (await sql`
    SELECT id, nome, sku, nome_placa, peso_placa_g, tempo_placa_h, pecas_na_placa,
           placa_id, pecas_na_placa_a2l, peso_placa_a2l_g, tempo_placa_a2l_h, pecas_por_unidade
    FROM produtos
    ORDER BY nome ASC
  `) as ProdutoRow[];

  const todosSkus = Array.from(
    new Set(rows.flatMap((r) => parseSkus(r.sku)))
  );

  let componentesRows: ComponenteRow[] = [];
  if (todosSkus.length > 0) {
    componentesRows = (await sql`
      SELECT sp.sku, p.id AS placa_id, p.nome,
             p.peso_placa_gramas, p.tempo_placa_horas,
             p.peso_placa_gramas_a2l, p.tempo_placa_horas_a2l,
             p.pecas_por_placa, p.pecas_por_placa_a2l,
             sp.pecas_por_unidade
      FROM sku_placa sp
      JOIN placas p ON p.id = sp.placa_id
      WHERE sp.sku = ANY(${todosSkus})
    `) as ComponenteRow[];
  }

  const produtos = rows.map((row) => {
    const produto = toProdutoInput(row);
    const skuList = parseSkus(row.sku);
    if (skuList.length === 0) return produto;
    const vistos = new Set<number>();
    const placasAdicionais: PlacaComponenteInput[] = [];
    for (const c of componentesRows) {
      if (!skuList.includes(c.sku)) continue;
      if (c.placa_id === row.placa_id) continue; // já é a placa principal
      if (vistos.has(c.placa_id)) continue;
      vistos.add(c.placa_id);
      placasAdicionais.push(componenteParaInput(c));
    }
    if (placasAdicionais.length > 0) produto.placasAdicionais = placasAdicionais;
    return produto;
  });

  return NextResponse.json(produtos);
}

export async function POST(request: NextRequest) {
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

  if (!nome || !nome.trim()) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }

  await garantirColunas();

  const skuList = parseSkus(sku);
  const pecasPorUnidadePrincipal = pecasPorUnidade || 1;

  const rows = (await sql`
    INSERT INTO produtos (
      nome, sku, nome_placa, peso_placa_g, tempo_placa_h, pecas_na_placa,
      pecas_na_placa_a2l, peso_placa_a2l_g, tempo_placa_a2l_h, pecas_por_unidade
    )
    VALUES (
      ${nome}, ${sku || null}, ${nomePlaca || null}, ${pesoPlacaG}, ${tempoPlacaH}, ${pecasNaPlaca},
      ${pecasNaPlacaA2l || null}, ${pesoPlacaA2lG || null}, ${tempoPlacaA2lH || null}, ${pecasPorUnidadePrincipal}
    )
    RETURNING id, nome, sku, nome_placa, peso_placa_g, tempo_placa_h, pecas_na_placa,
              pecas_na_placa_a2l, peso_placa_a2l_g, tempo_placa_a2l_h, pecas_por_unidade
  `) as ProdutoRow[];

  const placaIdPrincipal = await criarPlaca({
    nome: nomePlaca || nome,
    skuOuKit: skuList[0] || sku || null,
    pesoPlacaG,
    tempoPlacaH,
    pecasNaPlaca,
    pesoPlacaA2lG,
    tempoPlacaA2lH,
    pecasNaPlacaA2l,
  });
  await sql`UPDATE produtos SET placa_id = ${placaIdPrincipal} WHERE id = ${rows[0].id}`;

  for (const s of skuList) {
    await vincularSku(s, placaIdPrincipal, pecasPorUnidadePrincipal);
  }

  const placasAdicionaisSalvas: PlacaComponenteInput[] = [];
  for (const componente of placasAdicionais ?? []) {
    if (!componente.nome || !componente.nome.trim()) continue;
    const placaId = await criarPlaca({
      nome: componente.nome,
      skuOuKit: skuList[0] || sku || null,
      pesoPlacaG: componente.pesoPlacaG,
      tempoPlacaH: componente.tempoPlacaH,
      pecasNaPlaca: componente.pecasNaPlaca,
      pesoPlacaA2lG: componente.pesoPlacaA2lG,
      tempoPlacaA2lH: componente.tempoPlacaA2lH,
      pecasNaPlacaA2l: componente.pecasNaPlacaA2l,
    });
    const pecasPorUnidadeComponente = componente.pecasPorUnidade || 1;
    for (const s of skuList) {
      await vincularSku(s, placaId, pecasPorUnidadeComponente);
    }
    placasAdicionaisSalvas.push({ ...componente, placaId });
  }

  const produtoCriado = toProdutoInput(rows[0]);
  produtoCriado.placaId = placaIdPrincipal;
  if (placasAdicionaisSalvas.length > 0) {
    produtoCriado.placasAdicionais = placasAdicionaisSalvas;
  }

  return NextResponse.json(produtoCriado, { status: 201 });
}
