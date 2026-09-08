import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Debug temporario -- inspeciona produtos (placas) cujo sku comeca
// com "Componente:" (placas que sao so pedaco de um kit/produto
// composto, ex: corpo/gancho separados) e as linhas de sku_placa
// relacionadas, pra entender como BMW/Carregador BYD/Ganchos estao
// modelados hoje antes de arrumar a tela de Precificacao.
export async function GET() {
  const componentes = await sql`
  SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
  FROM produtos
  WHERE sku ILIKE 'Componente:%'
  ORDER BY nome ASC
  `;

const relacionados = await sql`
SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
FROM produtos
WHERE nome ILIKE '%BMW%' OR nome ILIKE '%CARREGADOR BYD%' OR nome ILIKE '%GANCHO%'
ORDER BY nome ASC
`;

const skuPlaca = await sql`
SELECT sp.sku, sp.placa_id, sp.pecas_por_unidade, pl.nome AS placa_nome
FROM sku_placa sp
JOIN placas pl ON pl.id = sp.placa_id
WHERE sp.sku ILIKE '%BMW%' OR sp.sku ILIKE '%CARREGADOR BYD%' OR sp.sku ILIKE '%GANCHO%'
OR pl.nome ILIKE '%BMW%' OR pl.nome ILIKE '%CARREGADOR BYD%' OR pl.nome ILIKE '%GANCHO%'
ORDER BY sp.sku ASC
`;

return NextResponse.json({ componentes, relacionados, skuPlaca });
}
