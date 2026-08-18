import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutencao UNICA (2026-08-18). Pedido do Guilherme: no anuncio ML
// "Kit Ganchos Para Box De Vidro" (6m e 8m), a variacao de cor Prata nunca
// foi cadastrada em nenhum lugar do catalogo -- so existiam placas Preto
// (id 53/59) e Branco (id 6/17). Vendas de "Kit X Prata" caiam direto em
// "nao identificado" e nunca viravam demanda de producao (SKU vazio).
// Alem disso, o anuncio 8mm tinha um erro de digitacao: as 3 variacoes
// Prata estavam com SKU "SUPORTE BOX 6MM PRATA" em vez de "8MM" (corrigido
// manualmente no Mercado Livre antes de rodar esta rota).
//
// Mesma peca fisica do Preto/Branco, so muda a cor do filamento -- por isso
// replica exatamente peso/tempo/pecas_por_placa/tier das placas ja
// existentes (id 53 Preto 6mm e id 59 Preto 8mm).
//
// Cria 2 placas novas "direta":
//   - Suporte Box 6mm (kit 1/2/3) (Prata)
//   - Suporte Box 8mm (kit 1/2/3) (Prata)
// E registra em sku_placa os 6 SKUs reais do ML:
//   1/2/3 SUPORTE BOX 6MM PRATA -> pecas_por_unidade 1/2/3
//   1/2/3 SUPORTE BOX 8MM PRATA -> pecas_por_unidade 1/2/3
//
// Estoque inicial: 0 (Guilherme confirmou que nao sabe a contagem fisica
// atual -- ajustar depois na aba Estoque).
//
// Idempotente: usa nome/sku como chave de "ja existe"; roda de novo sem
// duplicar nada.

const BOX_6MM = {
    nome: "Suporte Box 6mm (kit 1/2/3) (Prata)",
    skuOuKit: "1/2/3 SUPORTE BOX 6MM PRATA",
    pecasPorPlaca: 15,
    tempoPlacaHoras: 9.117,
    tier: "A",
    pesoPlacaGramas: 284.5,
    skuPrefixo: "SUPORTE BOX 6MM PRATA",
};

const BOX_8MM = {
    nome: "Suporte Box 8mm (kit 1/2/3) (Prata)",
    skuOuKit: "1/2/3 SUPORTE BOX 8MM PRATA",
    pecasPorPlaca: 13,
    tempoPlacaHoras: 8.7,
    tier: "C",
    pesoPlacaGramas: 231.5,
    skuPrefixo: "SUPORTE BOX 8MM PRATA",
};

export async function POST() {
    try {
          return await executar();
    } catch (err) {
          return NextResponse.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 }
                );
    }
}

async function proximoNumero(): Promise<number> {
    const rows = (await sql`
        SELECT COALESCE(MAX(numero), 0) AS max FROM placas
          `) as { max: number }[];
    return Number(rows[0].max) + 1;
}

async function criarPlacaSeNaoExiste(cfg: typeof BOX_6MM) {
    const existentes = (await sql`SELECT id FROM placas WHERE nome = ${cfg.nome}`) as { id: number }[];
    if (existentes.length > 0) {
          return { id: existentes[0].id, criada: false };
    }
    const numero = await proximoNumero();
    const inserida = (await sql`
        INSERT INTO placas (
              numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
                    pecas_por_placa, tempo_placa_horas, tier, descontinuada,
                          peso_placa_gramas
                              ) VALUES (
                                    ${numero}, ${cfg.nome}, 'direta', NULL, NULL, ${cfg.skuOuKit},
                                          ${cfg.pecasPorPlaca}, ${cfg.tempoPlacaHoras}, ${cfg.tier}, false,
                                                ${cfg.pesoPlacaGramas}
                                                    )
                                                        RETURNING id
                                                          `) as { id: number }[];
    const id = inserida[0].id;
    await sql`
        INSERT INTO estoque_placas (placa_id, quantidade_pecas) VALUES (${id}, 0)
            ON CONFLICT (placa_id) DO NOTHING
              `;
    return { id, criada: true };
}

async function linkarSkus(placaId: number, prefixo: string) {
    const criados: string[] = [];
    for (const qtd of [1, 2, 3]) {
          const sku = `${qtd} ${prefixo}`;
          const existente = (await sql`
                SELECT id FROM sku_placa WHERE sku = ${sku} AND placa_id = ${placaId}
                    `) as { id: number }[];
          if (existente.length > 0) continue;
          await sql`
                INSERT INTO sku_placa (sku, placa_id, pecas_por_unidade)
                      VALUES (${sku}, ${placaId}, ${qtd})
                          `;
          criados.push(sku);
    }
    return criados;
}

async function executar() {
    const resultado: Record<string, unknown> = {};

  const placa6mm = await criarPlacaSeNaoExiste(BOX_6MM);
    resultado.placa6mm = placa6mm;
    resultado.sku6mm = await linkarSkus(placa6mm.id, BOX_6MM.skuPrefixo);

  const placa8mm = await criarPlacaSeNaoExiste(BOX_8MM);
    resultado.placa8mm = placa8mm;
    resultado.sku8mm = await linkarSkus(placa8mm.id, BOX_8MM.skuPrefixo);

  return NextResponse.json({ ok: true, resultado });
}
