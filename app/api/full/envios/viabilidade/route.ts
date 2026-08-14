import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { todaySP } from "@/lib/date";
import {
    janelaAprendida,
    maquinasAtivas,
    diasDisponiveisAte,
    dataMinimaViavel,
} from "@/lib/capacidade";

export const dynamic = "force-dynamic";

// Preview de viabilidade ANTES de criar o envio -- pedido do Guilherme em
// 2026-08-14: "quando eu colocar a data que quero enviar o produto, deve
// fazer o envio com a possibilidade de eu conseguir enviar 100% da
// sugestao, com o estoque que eu tenho e caso eu precise produzir, que eu
// consiga com 4 maquinas rodando, produzir o que precisa para enviar".
//
// Diferente do badge de aprovado/risco que ja existe pra envios JA
// CRIADOS (GET /api/full/envios, corte de 50% -- pedido de 2026-07-29),
// aqui o corte e 100% da capacidade das maquinas (numMaquinasAtivas ja
// vem com a folga de 1 impressora aplicada em lib/capacidade.ts, regra
// do Guilherme em 2026-08-14), porque isso e so uma simulacao "e se eu
// confirmar esse envio agora com essa quantidade e essa data", sem
// nenhuma penalidade extra de reserva -- por isso o limite pode ser 100%
// em vez dos 50% do badge de risco.
export async function POST(request: NextRequest) {
    const body = await request.json();
    const itens = Array.isArray(body.itens) ? body.itens : [];
    const quantidade = Number(body.quantidade);
    const dataLimite = String(body.dataLimite ?? "").trim();

  if (itens.length === 0 || !quantidade || quantidade <= 0 || !dataLimite) {
        return NextResponse.json(
          { error: "Informe itens (placaId + pecasPorUnidade), quantidade (> 0) e dataLimite." },
          { status: 400 }
              );
  }

  const placaIds = Array.from(
        new Set(
                itens
                  .map((it: any) => Number(it.placaId))
                  .filter((id: number) => Number.isFinite(id) && id > 0)
              )
      ) as number[];

  if (placaIds.length === 0) {
        return NextResponse.json({ error: "itens invalidos." }, { status: 400 });
  }

  const [janela, numMaquinasAtivas] = await Promise.all([janelaAprendida(), maquinasAtivas()]);
    const hoje = todaySP();

  const placasInfoRows = (await sql`
      SELECT id, pecas_por_placa, tempo_placa_horas FROM placas WHERE id = ANY(${placaIds})
        `) as { id: number; pecas_por_placa: string; tempo_placa_horas: string }[];
    const placaInfoPorId = new Map(
          placasInfoRows.map((r) => [
                  r.id,
            { pecasPorPlaca: Number(r.pecas_por_placa), tempoPlacaHoras: Number(r.tempo_placa_horas) },
                ])
        );

  const estoqueRows = (await sql`
      SELECT placa_id, quantidade_pecas FROM estoque_placas WHERE placa_id = ANY(${placaIds})
        `) as { placa_id: number; quantidade_pecas: number }[];
    const estoquePorPlaca = new Map(estoqueRows.map((r) => [r.placa_id, Number(r.quantidade_pecas)]));

  const emProducaoRows = (await sql`
      SELECT pr.placa_id, pr.quantidade_placas, pl.pecas_por_placa
          FROM producoes pr
              JOIN placas pl ON pl.id = pr.placa_id
                  WHERE pr.status = 'em_andamento' AND pr.placa_id = ANY(${placaIds})
                    `) as { placa_id: number; quantidade_placas: number; pecas_por_placa: number }[];
    const emProducaoPorPlaca = new Map<number, number>();
    for (const r of emProducaoRows) {
          const pecas = Number(r.quantidade_placas) * Number(r.pecas_por_placa);
          emProducaoPorPlaca.set(r.placa_id, (emProducaoPorPlaca.get(r.placa_id) ?? 0) + pecas);
    }

  // Envios PENDENTES ja existentes dessas placas (mesma logica de
  // faltantePlaca em GET /api/full/envios) -- a quantidade proposta aqui
  // se SOMA a isso, nao substitui (o envio real ainda nao foi criado).
  const pendentesRows = (await sql`
      SELECT placa_id, quantidade, pecas_por_unidade
          FROM full_envios
              WHERE status = 'pendente' AND placa_id = ANY(${placaIds})
                `) as { placa_id: number; quantidade: number; pecas_por_unidade: number }[];
    const pendentePorPlaca = new Map<number, number>();
    for (const r of pendentesRows) {
          const pecas = Number(r.quantidade) * Number(r.pecas_por_unidade ?? 1);
          pendentePorPlaca.set(r.placa_id, (pendentePorPlaca.get(r.placa_id) ?? 0) + pecas);
    }

  const dias = diasDisponiveisAte(hoje, dataLimite);
    const horasPorDia = Math.max(0, janela.fechamentoHora - janela.aberturaHora);
    const capacidadeDisponivelHoras = numMaquinasAtivas * horasPorDia * dias;

  let horasNecessarias = 0;
    const porPlaca: { placaId: number; faltante: number; horasNecessarias: number }[] = [];

  for (const it of itens) {
        const placaId = Number(it.placaId);
        const pecasPorUnidadeRaw = Number(it.pecasPorUnidade);
        const pecasPorUnidadeItem =
                Number.isFinite(pecasPorUnidadeRaw) && pecasPorUnidadeRaw > 0 ? pecasPorUnidadeRaw : 1;
        const info = placaInfoPorId.get(placaId) ?? { pecasPorPlaca: 0, tempoPlacaHoras: 0 };
        const estoqueProjetado =
                (estoquePorPlaca.get(placaId) ?? 0) + (emProducaoPorPlaca.get(placaId) ?? 0);
        const pendenteExistente = pendentePorPlaca.get(placaId) ?? 0;
        const proposto = quantidade * pecasPorUnidadeItem;
        const faltante = Math.max(0, pendenteExistente + proposto - estoqueProjetado);
        const placasNecessarias =
                info.pecasPorPlaca > 0 ? Math.ceil(faltante / info.pecasPorPlaca) : 0;
        const horas = placasNecessarias * (info.tempoPlacaHoras || 0);
        horasNecessarias += horas;
        porPlaca.push({ placaId, faltante, horasNecessarias: horas });
  }

  const percentual =
        capacidadeDisponivelHoras > 0
        ? horasNecessarias / capacidadeDisponivelHoras
          : horasNecessarias > 0
        ? Infinity
          : 0;

  // Corte de 100% (nao 50%) -- ver comentario no topo do arquivo.
  const viavel100 = percentual <= 1;
    const dataMinima = dataMinimaViavel(horasNecessarias, hoje, numMaquinasAtivas, janela);

  return NextResponse.json({
        horasNecessarias,
        capacidadeDisponivelHoras,
        percentual,
        viavel100,
        dataMinimaViavel: dataMinima,
        numMaquinasAtivas,
        porPlaca,
  });
}
