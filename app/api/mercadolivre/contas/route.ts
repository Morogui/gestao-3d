import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getValidMLAccessToken, getValidMLAccessTokensExtras } from "@/lib/ml-auth";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

async function nick(userId: string, accessToken: string): Promise<string> {
  try {
    const r = await fetch(ML_API_BASE + "/users/" + userId, {
      headers: { Authorization: "Bearer " + accessToken },
      cache: "no-store",
    });
    if (!r.ok) return "?";
    const j = await r.json();
    return j.nickname || "?";
  } catch {
    return "?";
  }
}

export async function GET() {
  const contas: { conta: string; userId: string; nickname: string }[] = [];
  try {
    const p = await getValidMLAccessToken();
    if (p) {
      contas.push({
        conta: "principal",
        userId: String(p.userId),
        nickname: await nick(String(p.userId), p.accessToken),
      });
    }
  } catch {}
  const extras = await getValidMLAccessTokensExtras();
  for (const e of extras) {
    contas.push({ conta: e.conta, userId: e.userId, nickname: await nick(e.userId, e.accessToken) });
  }
  return NextResponse.json({ contas });
}

export async function DELETE(req: NextRequest) {
  const conta = req.nextUrl.searchParams.get("conta") || "";
  if (!conta || conta === "principal") {
    return NextResponse.json({ error: "conta invalida" }, { status: 400 });
  }
  await getValidMLAccessTokensExtras();
  await sql`DELETE FROM ml_auth_contas WHERE conta = ${conta}`;
  return NextResponse.json({ ok: true });
}
