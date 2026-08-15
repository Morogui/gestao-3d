import { NextResponse } from "next/server";
import { getAnaliseAnuncios } from "@/lib/ml-analise";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getAnaliseAnuncios();
    if (!result.connected) return NextResponse.json({ connected: false });
    if (result.error) return NextResponse.json({ connected: true, error: true });
    const grupos = result.grupos.map((g) => ({
      chave: g.chave,
      titulo: g.titulo,
      totalVariacoes: g.totalVariacoes,
    }));
    const singletons = grupos.filter((g) => g.totalVariacoes === 1);
    return NextResponse.json({
      totalAnuncios: result.totalAnuncios,
      totalVariacoes: result.totalVariacoes,
      totalGruposSingleton: singletons.length,
      singletonTitulos: singletons.map((g) => g.titulo),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message ?? err), stack: String(err?.stack ?? "") },
      { status: 500 }
    );
  }
}
