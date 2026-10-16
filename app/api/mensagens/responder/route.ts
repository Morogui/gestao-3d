import { NextRequest, NextResponse } from "next/server";
import { responderML, responderShopee } from "@/lib/mensagens";

export const dynamic = "force-dynamic";

// POST /api/mensagens/responder  { id, texto }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id: string = body?.id ?? "";
  const texto: string = String(body?.texto ?? "").trim();
  if (!id || !texto) {
    return NextResponse.json({ ok: false, erro: "id e texto sao obrigatorios" }, { status: 400 });
  }
  const r = id.startsWith("s:") ? await responderShopee(id, texto) : await responderML(id, texto);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
