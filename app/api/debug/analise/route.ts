import { NextResponse } from "next/server";
import { getAnaliseAnuncios } from "@/lib/ml-analise";

export const dynamic = "force-dynamic";

// Rota de diagnostico temporaria -- pedido do Guilherme em 2026-08-15:
// aba Analise esta mostrando 75 anuncios, mas o painel real do Mercado
// Livre mostra outro numero. Retorna a contagem bruta (totalVariacoes,
// itens individuais na ML) e a contagem agrupada (totalAnuncios, grupos
// por produto do catalogo), mais a lista de grupos (titulo + quantas
// variacoes) pra achar se o problema e paginacao, status incluido a
// mais, ou grupos que deveriam ter casado com o catalogo e nao casaram
// (viram "singleton", 1 por item_id, inflando a contagem). Remover
// depois de usar.
export async function GET() {
  try {
    const result = await getAnaliseAnuncios();
    if (!result.connected) {
      return NextResponse.json({ connected: false });
    }
    if (result.error) {
      return NextResponse.json({ connected: true, error: true });
    }
    const grupos = result.grupos.map((g) => ({
      chave: g.chave,
      titulo: g.titulo,
      totalVariacoes: g.totalVariacoes,
      skus: g.variacoes.map((v) => v.sku),
    }));
    const singletons = grupos.filter((g) => g.totalVariacoes === 1);
    return NextResponse.json({
      totalAnuncios: result.totalAnuncios,
      totalVariacoes: result.totalVariacoes,
      totalGruposSingleton: singletons.length,
      grupos,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
      { status: 500 }
    );
  }
}
