import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ML_API_BASE } from "@/lib/mercadolivre";

export const dynamic = "force-dynamic";

// Rota de diagnostico TEMPORARIA - pedido do Guilherme em 2026-08-11:
// "No mercado livre esses produtos tem a sku, na hora da api nao
// consegue puxer elas certinhas?". A aba Analise so le o atributo
// seller_custom_field. Essa rota devolve o JSON completo (incluindo
// attributes/variations) de um anuncio pra confirmar onde de fato mora
// o SKU no retorno da API da ML. Remover depois de usar.
export async function GET(
    _request: NextRequest,
  { params }: { params: { id: string } }
  ) {
    const cookieStore = cookies();
    const accessToken = cookieStore.get("ml_access_token")?.value;
    if (!accessToken) {
          return NextResponse.json({ error: "ML nao conectado" }, { status: 401 });
    }

  const resp = await fetch(`${ML_API_BASE}/items/${params.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
  });
    const data = await resp.json();
    return NextResponse.json({ status: resp.status, data });
}
