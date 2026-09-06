import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-09-06). Guilherme pediu pra cadastrar o
// novo produto "SKU GORRO DE NATAL", montado a partir de 2 placas fisicas:
// - "Gorro de Natal": placa direta (so um tipo de peca), 6 gorros por
//   placa, 201g / 8h21min.
// - "Enfeite Natal - Base + Bolinha (Mista)": placa composta (mesmo
//   padrao ja usado em Suporte Carro Mista / Suporte Universal Mista),
//   produz 4 bases + 4 bolinhas JUNTOS na mesma impressao (183g /
//   6h30min no total pra placa inteira). Como as duas pecas sempre saem
//   juntas na producao real (nao existe placa "so bolinha" ou "so base"
//   fisicamente), a placa "Bolinha (avulsa)" abaixo e so um registro de
//   apoio - existe pra ter um placa_id valido onde creditar o estoque da
//   bolinha quando a producao da Mista for confirmada; ela nunca sera
//   carregada sozinha na pratica (fica com dados_confirmados=false pra
//   deixar isso sinalizado).
// Produto final (1un) = 1 Gorro + 1 Base + 1 Bolinha (linhas em
// sku_placa, mesmo mecanismo de composicao usado em todo o catalogo).
// Idempotente: usa nome da placa como chave de "ja existe".

interface NovaPlaca {
  nome: string;
  tipo: string;
  papel: string | null;
  grupoComposto: string | null;
  skuOuKit: string;
  pecasPorPlaca: number;
  tempoPlacaHoras: number;
  pesoPlacaGramas: number;
  saidaExtraPlacaNome?: string;
  saidaExtraPecas?: number;
  dadosConfirmados: boolean;
}

const NOVAS: NovaPlaca[] = [
  {
    nome: "Gorro de Natal",
    tipo: "direta",
    papel: null,
    grupoComposto: null,
    skuOuKit: "GORRO DE NATAL - GORRO",
    pecasPorPlaca: 6,
    tempoPlacaHoras: 8 + 21 / 60,
    pesoPlacaGramas: 201,
    dadosConfirmados: true,
  },
  {
    nome: "Enfeite Natal - Bolinha (avulsa)",
    tipo: "composto",
    papel: "bolinha",
    grupoComposto: "Enfeite Natal (Base+Bolinha)",
    skuOuKit: "ENFEITE NATAL - BOLINHA",
    pecasPorPlaca: 4,
    tempoPlacaHoras: 3.25,
    pesoPlacaGramas: 91.5,
    dadosConfirmados: false,
  },
  {
    nome: "Enfeite Natal - Base + Bolinha (Mista)",
    tipo: "composto",
    papel: "base",
    grupoComposto: "Enfeite Natal (Base+Bolinha)",
    skuOuKit: "ENFEITE NATAL - BASE",
    pecasPorPlaca: 4,
    tempoPlacaHoras: 6.5,
    pesoPlacaGramas: 183,
    saidaExtraPlacaNome: "Enfeite Natal - Bolinha (avulsa)",
    saidaExtraPecas: 4,
    dadosConfirmados: true,
  },
];

const SKU_PRODUTO = "SKU GORRO DE NATAL";

export async function POST() {
  const criadas: { id: number; nome: string }[] = [];
  const jaExistiam: { id: number; nome: string }[] = [];
  const idsPorNome: Record<string, number> = {};

  const maxNumeroRows = (await sql`
    SELECT COALESCE(MAX(numero), 0) AS max FROM placas
  `) as { max: number }[];
  let proximoNumero = Math.max(300, Number(maxNumeroRows[0].max) + 1);

  for (const nova of NOVAS) {
    const existente = (await sql`
      SELECT id, nome FROM placas WHERE nome = ${nova.nome}
    `) as { id: number; nome: string }[];
    if (existente.length > 0) {
      jaExistiam.push(existente[0]);
      idsPorNome[nova.nome] = existente[0].id;
      continue;
    }

    let saidaExtraPlacaId: number | null = null;
    if (nova.saidaExtraPlacaNome) {
      saidaExtraPlacaId = idsPorNome[nova.saidaExtraPlacaNome] ?? null;
      if (saidaExtraPlacaId === null) {
        const ref = (await sql`
          SELECT id FROM placas WHERE nome = ${nova.saidaExtraPlacaNome}
        `) as { id: number }[];
        if (ref.length === 0) {
          return NextResponse.json(
            {
              error: `Placa de referencia "${nova.saidaExtraPlacaNome}" nao encontrada - abortando sem criar "${nova.nome}".`,
            },
            { status: 400 }
          );
        }
        saidaExtraPlacaId = ref[0].id;
      }
    }

    const inserida = (await sql`
      INSERT INTO placas (
        numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
        pecas_por_placa, tempo_placa_horas, tier, descontinuada,
        peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas, dados_confirmados
      ) VALUES (
        ${proximoNumero}, ${nova.nome}, ${nova.tipo}, ${nova.papel}, ${nova.grupoComposto}, ${nova.skuOuKit},
        ${nova.pecasPorPlaca}, ${nova.tempoPlacaHoras}, 'B', false,
        ${nova.pesoPlacaGramas}, ${saidaExtraPlacaId}, ${nova.saidaExtraPecas ?? null}, ${nova.dadosConfirmados}
      )
      RETURNING id, nome
    `) as { id: number; nome: string }[];

    await sql`
      INSERT INTO estoque_placas (placa_id, quantidade_pecas)
      VALUES (${inserida[0].id}, 0)
      ON CONFLICT (placa_id) DO NOTHING
    `;

    idsPorNome[nova.nome] = inserida[0].id;
    criadas.push(inserida[0]);
    proximoNumero += 1;
  }

  // Composicao do produto final: 1 Gorro + 1 Base + 1 Bolinha
  const composicao: { placaNome: string; pecas: number }[] = [
    { placaNome: "Gorro de Natal", pecas: 1 },
    { placaNome: "Enfeite Natal - Base + Bolinha (Mista)", pecas: 1 },
    { placaNome: "Enfeite Natal - Bolinha (avulsa)", pecas: 1 },
  ];
  for (const item of composicao) {
    const placaId = idsPorNome[item.placaNome];
    if (!placaId) continue;
    const existenteComp = await sql`
      SELECT 1 FROM sku_placa WHERE sku = ${SKU_PRODUTO} AND placa_id = ${placaId}
    `;
    if (existenteComp.length === 0) {
      await sql`
        INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
        VALUES (${SKU_PRODUTO}, ${placaId}, ${item.pecas})
      `;
    }
  }

  return NextResponse.json({ ok: true, criadas, jaExistiam, idsPorNome, sku: SKU_PRODUTO });
}
