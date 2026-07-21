import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de uso único (chamada manual pelo navegador) pra popular a aba
// Custo com o catálogo de placas já cadastrado em Produção — o usuário
// pediu pra "subir todos os produtos que já temos cadastrados" na aba
// Custo em vez de digitar um por um.
//
// Usa nome, sku (representante — a primeira SKU em ordem alfabética
// mapeada pra essa placa em sku_placa, já que várias cores/variações
// podem apontar pra mesma placa física), tempo_placa_horas e
// pecas_por_placa vindos do catálogo de Produção.
//
// IMPORTANTE: peso da placa (peso_placa_g) NUNCA foi capturado em
// nenhum lugar do sistema — o catálogo de Produção não tem esse campo.
// Entra como 0 aqui; o usuário precisa completar manualmente na aba
// Custo pra cada produto (senão o custo de filamento calculado fica
// zerado). Isso é sinalizado na resposta desta rota.
//
// Idempotente: só insere placas cujo nome ainda não existe em produtos
// (rodar de novo não duplica).
export async function GET() {
  const jaExistem = (await sql`SELECT nome FROM produtos`) as { nome: string }[];
  const nomesExistentes = new Set(jaExistem.map((r) => r.nome));

  const placas = (await sql`
    SELECT p.id, p.numero, p.nome, p.tempo_placa_horas, p.pecas_por_placa,
      (SELECT MIN(sp.sku) FROM sku_placa sp WHERE sp.placa_id = p.id) AS sku_rep
    FROM placas p
    WHERE p.descontinuada = false
    ORDER BY p.numero ASC
  `) as {
    id: number;
    numero: number;
    nome: string;
    tempo_placa_horas: string;
    pecas_por_placa: string;
    sku_rep: string | null;
  }[];

  const inseridos: string[] = [];
  const ignorados: string[] = [];

  for (const placa of placas) {
    if (nomesExistentes.has(placa.nome)) {
      ignorados.push(placa.nome);
      continue;
    }
    await sql`
      INSERT INTO produtos (nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa)
      VALUES (${placa.nome}, ${placa.sku_rep}, 0, ${placa.tempo_placa_horas}, ${placa.pecas_por_placa})
    `;
    inseridos.push(placa.nome);
  }

  return NextResponse.json({
    inseridos: inseridos.length,
    ignorados: ignorados.length,
    detalhe: { inseridos, ignorados },
    aviso:
      "peso_placa_g entrou como 0 pra todos os produtos importados — esse dado nunca foi capturado no catálogo de Produção. Complete manualmente na aba Custo pra cada produto, senão o custo de filamento fica zerado.",
  });
}
