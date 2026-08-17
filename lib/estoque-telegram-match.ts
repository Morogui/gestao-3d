import { sql } from "@/lib/db";
import { DbPlacaRow, PlacaRow, toPlacaRow } from "@/lib/placas";
import { correspondeAoItem } from "@/lib/demanda";

// Casamento de texto livre (mensagem do Telegram) -> placa do catálogo,
// pro lançamento de entrada/saída de estoque via bot (pedido do
// Guilherme em 2026-08-17: "eu aviso se vai ser entrada ou saida de
// produto no telegram e ele ja atuliza no nosso estoque"). Reaproveita
// EXATAMENTE a mesma função correspondeAoItem() já usada e testada pra
// casar título/SKU de venda real (ML/Shopee) com uma placa — mesma regra
// de nome/SKU/frasesCorrespondencia + guarda de cor — em vez de inventar
// um segundo critério de match só pro Telegram.

export type PlacaCandidata = {
  id: number;
  numero: number;
  nome: string;
};

export async function buscarPlacaPorTexto(
  texto: string
): Promise<{ unica: PlacaCandidata | null; candidatas: PlacaCandidata[] }> {
  const rows = (await sql`
    SELECT
      p.id, p.numero, p.nome, p.tipo, p.papel, p.grupo_composto, p.sku_ou_kit,
      p.frases_correspondencia, p.pecas_por_placa, p.tempo_placa_horas, p.tier,
      p.descontinuada, p.peso_placa_gramas, p.saida_extra_placa_id,
      p.saida_extra_pecas, p.dados_confirmados, '0' AS estoque
    FROM placas p
    WHERE p.descontinuada = false
  `) as DbPlacaRow[];

  const placas: PlacaRow[] = rows.map(toPlacaRow);
  const encontradas = placas.filter((p) => correspondeAoItem(p, texto));

  const candidatas: PlacaCandidata[] = encontradas.map((p) => ({
    id: p.id,
    numero: p.numero,
    nome: p.nome,
  }));

  const unica = candidatas.length === 1 ? candidatas[0] : null;

  return { unica, candidatas };
}
