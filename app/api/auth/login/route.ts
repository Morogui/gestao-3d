import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username, password } = body as { username?: string; password?: string };

  const expectedUser = process.env.AUTH_USERNAME;
  const salt = process.env.AUTH_PASSWORD_SALT;
  const expectedHash = process.env.AUTH_PASSWORD_HASH;
  const sessionSecret = process.env.AUTH_SESSION_SECRET;

  if (!expectedUser || !salt || !expectedHash || !sessionSecret) {
    return NextResponse.json({ error: "Auth nao configurado" }, { status: 500 });
  }

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Dados invalidos" }, { status: 400 });
  }

  const userOk = username === expectedUser;
  const hash = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHash, "hex");
  const hashOk = hash.length === expectedBuf.length && crypto.timingSafeEqual(hash, expectedBuf);

  if (!userOk || !hashOk) {
    return NextResponse.json({ error: "Usuario ou senha incorretos" }, { status: 401 });
  }

  const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
  const exp = Date.now() + maxAgeMs;
  const sig = crypto.createHmac("sha256", sessionSecret).update(String(exp)).digest("hex");
  const token = `${exp}.${sig}`;

  const res = NextResponse.json({ ok: true });
  res.cookies.set("g3d_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
  return res;
}
