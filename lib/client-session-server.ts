import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.AUTH_SESSION_SECRET || "";

export interface ClientSessionPayload {
  clientId: string;
  abas: string[];
  exp: number;
}

function assinar(payloadB64: string): string {
  return createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
}

export function criarClientSessionCookie(payload: ClientSessionPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = assinar(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verificarClientSessionNode(cookieValue: string | undefined): ClientSessionPayload | null {
  if (!cookieValue) return null;
  const partes = cookieValue.split(".");
  if (partes.length !== 2) return null;
  const [payloadB64, sig] = partes;

const esperado = assinar(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

try {
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8")) as ClientSessionPayload;
  if (!payload.exp || Date.now() > payload.exp) return null;
  if (!payload.clientId) return null;
  return payload;
} catch {
  return null;
}
}
