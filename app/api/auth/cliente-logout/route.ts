import { NextResponse } from "next/server";

// Logout de cliente externo -- limpa so o client_session, nunca mexe no
// g3d_session da Morolar (sao cookies totalmente separados).
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("client_session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
  return res;
}
