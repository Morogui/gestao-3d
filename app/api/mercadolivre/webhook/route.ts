import { NextRequest, NextResponse } from "next/server";

// Endpoint de notificações (webhook) do Mercado Livre.
// A ML manda um POST aqui sempre que algo muda (novo pedido, pagamento,
// envio, etc — depende dos "Tópicos" marcados no app). Por enquanto só
// confirmamos o recebimento (200 OK) rapidamente, que é o que a ML exige.
// Quando a aba de Faturamento/Métricas for construída de verdade, este
// endpoint pode passar a processar as notificações (ex: guardar num banco
// de dados, invalidar cache, etc).

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Log mínimo por enquanto — nada sensível, só pra depuração.
    console.log("[ML webhook] notificação recebida:", {
      topic: body?.topic,
      resource: body?.resource,
      userId: body?.user_id,
    });
  } catch {
    // Se não vier JSON válido, não faz mal — só confirmamos o recebimento.
  }

  return NextResponse.json({ received: true }, { status: 200 });
}

// A ML pode fazer um GET de verificação em alguns fluxos de configuração.
export async function GET() {
  return NextResponse.json({ ok: true });
}
