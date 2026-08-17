import { sql } from "@/lib/db";
import { corFilamentoDaPlaca } from "@/lib/placas";

// Extraido de app/api/estoque/route.ts (POST) em 2026-08-17 pra ser
// reaproveitado pelo lançamento de estoque via Telegram (ver
// app/api/telegram/webhook/route.ts) — a lógica de ajuste (upsert em
// estoque_placas + histórico em ajustes_manuais_estoque + desconto ou
// devolução de filamento) é EXATAMENTE a mesma, só muda de onde é
// chamada (formulário na aba Estoque vs. mensagem no Telegram).

export type ResultadoAjusteEstoque = {
  placaId: number;
  quantidadePecas: number;
  atualizadoEm: string;
};

async function ajustarFilamentoPorPecas(placaId: number, deltaPecas: number) {
  const placaRows = (await sql`
    SELECT nome, pecas_por_placa, peso_placa_gramas FROM placas WHERE id = ${placaId}
  `) as { nome: string; pecas_por_placa: string; peso_placa_gramas: string | null }[];

  const placa = placaRows[0];
  if (!placa) return;

  const pecasPorPlaca = Number(placa.pecas_por_placa);
  const pesoPlacaGramas = placa.peso_placa_gramas ? Number(placa.peso_placa_gramas) : null;
  if (!pesoPlacaGramas || !pecasPorPlaca) return;

  const cor = corFilamentoDaPlaca(placa.nome);
  if (!cor) return;

  const gramasPorPeca = pesoPlacaGramas / pecasPorPlaca;
  const deltaGramas = -deltaPecas * gramasPorPeca; // lançar peças (delta>0) DESCONTA filamento

  await sql`
    INSERT INTO estoque_filamento (cor, quantidade_gramas, atualizado_em)
    VALUES (${cor}, 0, now())
    ON CONFLICT (cor) DO NOTHING
  `;
  await sql`
    UPDATE estoque_filamento
    SET quantidade_gramas = GREATEST(0, quantidade_gramas + ${deltaGramas}), atualizado_em = now()
    WHERE cor = ${cor}
  `;
}

// Ajusta (soma ou subtrai) "delta" peças no estoque_placas de uma placa,
// registra o histórico em ajustes_manuais_estoque e desconta/devolve o
// filamento equivalente. Upsert (INSERT ... ON CONFLICT): funciona mesmo
// se a placa ainda não tiver linha em estoque_placas.
export async function ajustarEstoque(
  placaId: number,
  delta: number
): Promise<ResultadoAjusteEstoque> {
  const rows = (await sql`
    INSERT INTO estoque_placas (placa_id, quantidade_pecas, atualizado_em)
    VALUES (${placaId}, GREATEST(0, ${delta}), now())
    ON CONFLICT (placa_id) DO UPDATE
    SET quantidade_pecas = GREATEST(0, estoque_placas.quantidade_pecas + ${delta}), atualizado_em = now()
    RETURNING placa_id, quantidade_pecas, atualizado_em
  `) as { placa_id: number; quantidade_pecas: number; atualizado_em: string }[];

  await sql`
    INSERT INTO ajustes_manuais_estoque (placa_id, delta, resultante)
    VALUES (${placaId}, ${delta}, ${rows[0].quantidade_pecas})
  `;

  await ajustarFilamentoPorPecas(placaId, delta);

  return {
    placaId: rows[0].placa_id,
    quantidadePecas: rows[0].quantidade_pecas,
    atualizadoEm: rows[0].atualizado_em,
  };
}
