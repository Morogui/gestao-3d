import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Vínculos placa -> SKU (tabela sku_placa) com a quantidade de peças da
// placa por unidade vendida. Usado pelo popup de confirmação de produção
// (2026-11-27): lista os SKUs da placa, as outras placas de cada SKU, e
// permite confirmar/corrigir a quantidade.
async function garantirColuna() {
  await sql`ALTER TABLE placas ADD COLUMN IF NOT EXISTS vinculos_confirmados BOOLEAN NOT NULL DEFAULT false`;
}

function normSku(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, "");
}

interface LinhaComponente {
  sku: string;
  placa_id: number;
  pecas_por_unidade: string;
  placa_nome: string;
  descontinuada: boolean;
  estoque: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const placaId = Number(params.id);
  if (!Number.isInteger(placaId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  await garantirColuna();

  const placaRows = (await sql`
    SELECT vinculos_confirmados FROM placas WHERE id = ${placaId}
  `) as { vinculos_confirmados: boolean }[];
  if (placaRows.length === 0) {
    return NextResponse.json({ error: "placa não encontrada" }, { status: 404 });
  }

  const componentes = (await sql`
    SELECT sp.sku, sp.placa_id, sp.pecas_por_unidade,
           pl.nome AS placa_nome, pl.descontinuada,
           COALESCE(e.quantidade_pecas, 0) AS estoque
    FROM sku_placa sp
    JOIN placas pl ON pl.id = sp.placa_id
    LEFT JOIN estoque_placas e ON e.placa_id = pl.id
    WHERE sp.sku IN (SELECT sku FROM sku_placa WHERE placa_id = ${placaId})
    ORDER BY sp.sku
  `) as LinhaComponente[];

  const porSku = new Map<string, LinhaComponente[]>();
  for (const c of componentes) {
    porSku.set(c.sku, [...(porSku.get(c.sku) ?? []), c]);
  }

  const itens = Array.from(porSku.entries()).map(([sku, comps]) => {
    const minha = comps.find((c) => c.placa_id === placaId)!;
    const ativas = comps.filter((c) => !c.descontinuada);
    // Vendável = gargalo entre as placas ativas do SKU.
    const vendavel =
      ativas.length === 0
        ? 0
        : Math.min(
            ...ativas.map((c) =>
              Number(c.pecas_por_unidade) > 0
                ? Math.floor(Number(c.estoque) / Number(c.pecas_por_unidade))
                : 0
            )
          );
    return {
      sku,
      tipo: /^MLB\d+$/i.test(sku.trim()) ? ("anuncio_ml" as const) : ("sku" as const),
      pecasPorUnidade: Number(minha.pecas_por_unidade),
      // Só placas ativas contam no selo "N placas" e em "Também usa":
      // vínculo antigo com placa descontinuada é cadastro velho, não consumo.
      totalPlacas: Math.max(1, ativas.length),
      outrasPlacas: comps
        .filter((c) => c.placa_id !== placaId && !c.descontinuada)
        .map((c) => ({
          nome: c.placa_nome,
          descontinuada: c.descontinuada,
          pecasPorUnidade: Number(c.pecas_por_unidade),
          estoque: Number(c.estoque),
        })),
      vendavel,
    };
  });

  // Popup limpo: uma linha por SKU (grafias que só diferem em espaço/caixa,
  // ex. "Guarda Sol" x "GuardaSol", viram uma só) e anúncios MLB só aparecem
  // se a placa não tiver nenhum SKU.
  const temSku = itens.some((i) => i.tipo === "sku");
  const vistos = new Set<string>();
  const itensLimpos = itens.filter((i) => {
    if (temSku && i.tipo === "anuncio_ml") return false;
    const k = normSku(i.sku);
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  return NextResponse.json({
    placaId,
    confirmado: placaRows[0].vinculos_confirmados,
    itens: itensLimpos,
  });
}

// body: { itens: [{ sku, pecasPorUnidade }], confirmar?: boolean }
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const placaId = Number(params.id);
  if (!Number.isInteger(placaId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  await garantirColuna();

  const body = (await request.json().catch(() => null)) as {
    itens?: { sku: string; pecasPorUnidade: number }[];
    confirmar?: boolean;
  } | null;
  const itens = body?.itens ?? [];

  for (const it of itens) {
    const q = Number(it.pecasPorUnidade);
    if (!it.sku || !Number.isFinite(q) || q <= 0) {
      return NextResponse.json(
        { error: `Quantidade inválida para ${it.sku || "(sem sku)"}: informe um número maior que 0.` },
        { status: 400 }
      );
    }
  }
  for (const it of itens) {
    await sql`
      UPDATE sku_placa SET pecas_por_unidade = ${Number(it.pecasPorUnidade)}
      WHERE placa_id = ${placaId}
        AND (sku = ${it.sku}
             OR lower(regexp_replace(sku, '[[:space:]_-]+', '', 'g')) = ${normSku(it.sku)})
    `;
  }
  if (body?.confirmar) {
    await sql`UPDATE placas SET vinculos_confirmados = true WHERE id = ${placaId}`;
  }
  return NextResponse.json({ ok: true, confirmado: !!body?.confirmar });
}
