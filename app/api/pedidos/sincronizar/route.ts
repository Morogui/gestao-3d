import { NextRequest, NextResponse } from "next/server";
import { sincronizarPedidos } from "@/lib/pedidos-cache";

export const dynamic = "force-dynamic";
// Sincroniza vários pedidos (item por item, INSERT sequencial) — pode
// levar mais que os 10s padrão da Vercel numa janela grande (ex: backfill
// manual de 90+ dias). 60s cobre isso com folga; janelas curtas (o cron de
// 1 em 1 minuto) terminam bem mais rápido que isso.
export const maxDuration = 60;

// Janela padrão do cron de 1 em 1 minuto — curta de propósito: só
// pedidos criados/alterados recentemente entram numa janela dessas
// (pedido novo, status mudou de não-pago pra pago, cancelamento). Pedidos
// mais antigos não mudam de estado sozinhos, então não precisam ser
// re-buscados toda hora. Uma janela maior roda 1x/dia (vercel.json) e
// pode ser disparada manualmente com ?dias=N pra reforçar/backfillar
// histórico.
const JANELA_PADRAO_DIAS = 5;

// Registro de atualização de pedidos — pedido do Guilherme em 2026-07-24:
// "abra um registro de atualização de pedidos e consulte esse registro de
// 1 em 1 minuto". Esse route handler é o único lugar do sistema que
// efetivamente chama a API ao vivo da ML/Shopee pra manter esse registro
// (pedidos_cache) em dia — ver lib/pedidos-cache.ts pra detalhes. GET
// (usado pelo cron da Vercel) e POST (usado por um botão manual, se
// precisar forçar antes do próximo minuto) fazem a mesma coisa.
async function handle(req: NextRequest) {
  const diasParam = req.nextUrl.searchParams.get("dias");
  const dias = diasParam ? Number(diasParam) : JANELA_PADRAO_DIAS;
  if (!Number.isFinite(dias) || dias <= 0) {
    return NextResponse.json({ error: "dias inválido" }, { status: 400 });
  }

  const resultado = await sincronizarPedidos(dias);
  return NextResponse.json({ ok: true, ...resultado });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
