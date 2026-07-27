import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Serve o arquivo original (imagem/PDF) de um lançamento pra abrir
// direto no navegador — pedido do Guilherme em 2026-07-27: "clicar em
// comprovantes e abra a aba com todos comprovantes salvos". O arquivo
// já está guardado como base64 na própria linha (ver POST
// /api/financeiro/lancamentos); aqui só decodifica e devolve com o
// Content-Type certo (Content-Disposition inline, então abre no
// visualizador do navegador em vez de forçar download).
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const rows = (await sql`
    SELECT arquivo_nome, arquivo_mime, arquivo_base64
    FROM financeiro_lancamentos
    WHERE id = ${id}
  `) as {
    arquivo_nome: string | null;
    arquivo_mime: string | null;
    arquivo_base64: string | null;
  }[];

  const row = rows[0];
  if (!row || !row.arquivo_base64) {
    return NextResponse.json(
      { error: "Esse lançamento não tem comprovante anexado." },
      { status: 404 }
    );
  }

  const buffer = Buffer.from(row.arquivo_base64, "base64");
  const nomeSeguro = (row.arquivo_nome ?? "comprovante").replace(/"/g, "");

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": row.arquivo_mime ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${nomeSeguro}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
