import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Extrato das baixas de estoque geradas por envios do Full confirmados —
// pedido do Guilherme em 2026-07-31: "deve ter... um botão para abrir um
// [extrato] com as movimentações feitas em estoque, para eu ver o que do
// full descontou do estoque e de qual sku. Pois eu dei baixa agora em 10
// unidades do Box 6mm branco e ele não deu baixa de 30un do meu
// estoque" — motivado justamente por descobrir o bug de kit (ver
// garantirColunaPecasPorUnidade em ../route.ts). Cada linha aqui é uma
// confirmação de envio (baixas_estoque_full_envios), com o SKU e a placa
// reais por trás — o mesmo dado que já aparecia espalhado no histórico
// por-placa da aba Estoque (tipo "full"), só que agora reunido numa visão
// só da aba Full, sem precisar abrir placa por placa.
export async function GET() {
  const rows = (await sql`
    SELECT
      b.id, b.criado_em, b.pecas, b.envio_id,
      fe.sku, fe.quantidade, fe.pecas_por_unidade, fe.data_limite,
      pl.nome AS placa_nome, pl.numero AS placa_numero
    FROM baixas_estoque_full_envios b
    JOIN full_envios fe ON fe.id = b.envio_id
    JOIN placas pl ON pl.id = b.placa_id
    ORDER BY b.criado_em DESC
    LIMIT 200
  `) as {
    id: number;
    criado_em: string;
    pecas: number;
    envio_id: number;
    sku: string;
    quantidade: number;
    pecas_por_unidade: number | null;
    data_limite: string;
    placa_nome: string;
    placa_numero: number;
  }[];

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      data: r.criado_em,
      envioId: r.envio_id,
      sku: r.sku,
      placaNome: r.placa_nome,
      placaNumero: r.placa_numero,
      quantidadeUnidades: Number(r.quantidade),
      pecasPorUnidade: Number(r.pecas_por_unidade ?? 1),
      pecasBaixadas: Number(r.pecas),
      dataLimiteEnvio: r.data_limite,
    }))
  );
}
