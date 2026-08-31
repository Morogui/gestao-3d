import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Temporario - pedido do Guilherme em 2026-08-31: "Eu lancei mais 2
// produtos no full que sao os suporte secador prata, ajuste nossos
// produtos que agora temos a cor prata, a placa e a mesma placa so que
// da cor prata". Cria a placa Suporte Secador de Cabelo (Prata) com os
// mesmos dados de peso/tempo/pecas da placa Preto (id 49) - mesmo
// desenho, so muda a cor do filamento. Deletar essa rota depois de
// rodar uma vez.
export async function GET() {
  const existe = await sql`SELECT id FROM placas WHERE nome = 'Suporte Secador de Cabelo (Prata)'`;
  if (existe.length > 0) {
    return NextResponse.json({ ok: true, jaExiste: true, id: existe[0].id });
  }
  const rows = await sql`
    INSERT INTO placas (
      numero, nome, tipo, papel, grupo_composto, sku_ou_kit,
      frases_correspondencia, pecas_por_placa, tempo_placa_horas, tier,
      descontinuada, peso_placa_gramas, saida_extra_placa_id, saida_extra_pecas,
      dados_confirmados
    )
    VALUES (
      (SELECT COALESCE(MAX(numero), 0) + 1 FROM placas),
      'Suporte Secador de Cabelo (Prata)', 'direta', NULL, NULL,
      'SUPORTE SECADOR DE CABELO PRATA', NULL, 4, 4.583333333333333, 'A',
      false, 123, NULL, NULL, true
    )
    RETURNING id, numero, nome
  `;
  return NextResponse.json({ ok: true, criada: rows[0] });
}
