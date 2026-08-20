import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("g3d_session", "", { path: "/", maxAge: 0 });
  return res;
}
