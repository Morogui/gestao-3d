import { NextRequest, NextResponse } from "next/server";
import { threadML, threadShopee } from "@/lib/mensagens";

export const dynamic = "force-dynamic";

// GET /api/mensagens/thread?id=q:123 | p:pack/seller | s:conversationId
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ erro: "id obrigatorio" }, { status: 400 });
  const r = id.startsWith("s:") ? await threadShopee(id) : await threadML(id);
  return NextResponse.json(r);
}
