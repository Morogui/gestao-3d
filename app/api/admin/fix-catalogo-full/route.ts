import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rota de manutenção ÚNICA (rodar 1x manualmente via fetch) — corrige um
// lote de anúncios reais que apareceram em "não bateram com nenhuma
// placa do catálogo" na aba Produção em 2026-07-26, mas que o Guilherme
// confirmou que são produtos JÁ cadastrados (só o texto do anúncio não
// batia com nenhuma frase alternativa registrada). Mesma técnica já
// usada nas placas 50 e 58 (frases alternativas separadas por "|" no
// sku_ou_kit, casadas por substring em lib/demanda.ts::textoCorresponde)
// — aqui só extende pra mais placas. Idempotente: só adiciona a frase
// se ela ainda não estiver presente no sku_ou_kit atual.
//
// Grupos corrigidos:
// 1) Cortina (com ou sem parafuso) (Branco) [id 12] — só a Preta (id 58)
//    tinha as frases alternativas do anúncio real "Par Prendedor De
//    Cortina Gancho Removível Fácil Instalação...".
// 2) Suporte BMW - Corpos/Ganchos (Branco e Preto) [28, 29, 64, 65] —
//    anúncio real usa "Suporte De Parede Carregador Carro Elétrico Tipo
//    2 BMW", nome comercial nenhum pouco parecido com "Suporte BMW".
// 3) Suporte Carro - Corpos/Mista (Branco/Cinza/Preto) [8, 9, 54, 55,
//    56, 57] — mesma lógica, anúncio "...Carregador Carro Elétrico Tipo
//    2 Universal".
// 4) Suporte Multigancho (Preto) [id 50] — variante de anúncio
//    "...Organizador Gillete Branco Suporte Preto" (a placa já tinha uma
//    frase parecida, mas com "Banheiro" no lugar de "Gillete" — títulos
//    diferentes de anúncios diferentes do mesmo produto).
const FRASES_POR_PLACA: Record<number, string[]> = {
  12: [
    "Par Prendedor De Cortina Gancho Removivel Facil Instalacao Par Com Parafuso",
    "Par Prendedor De Cortina Gancho Removivel Facil Instalacao Par Sem Parafusos",
  ],
  28: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw"],
  29: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw"],
  64: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw"],
  65: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Bmw"],
  8: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  9: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  54: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  55: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  56: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  57: ["Suporte De Parede Carregador Carro Eletrico Tipo 2 Universal"],
  50: ["Suporte Porta Escova Para Parede Cabelo Organizador Gillete Branco Suporte Preto"],
};

function normalizeLower(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Migração idempotente (2026-07-26) — tabela que registra a baixa de
// estoque local disparada quando um envio planejado do Full é
// confirmado (ver PATCH /api/full/envios/[id]). Colocada aqui pra
// reaproveitar essa rota de manutenção já existente em vez de precisar
// abrir o console do Neon de novo.
async function garantirTabelaBaixaFull() {
  await sql`
    CREATE TABLE IF NOT EXISTS baixas_estoque_full_envios (
      id SERIAL PRIMARY KEY,
      envio_id INTEGER NOT NULL REFERENCES full_envios(id),
      placa_id INTEGER NOT NULL REFERENCES placas(id),
      pecas INTEGER NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
}

export async function POST() {
  await garantirTabelaBaixaFull();

  const placaIds = Object.keys(FRASES_POR_PLACA).map(Number);
  const rows = (await sql`
    SELECT id, sku_ou_kit FROM placas WHERE id = ANY(${placaIds})
  `) as { id: number; sku_ou_kit: string }[];

  const atualizados: { id: number; antes: string; depois: string }[] = [];

  for (const row of rows) {
    const frases = FRASES_POR_PLACA[row.id] ?? [];
    let novoValor = row.sku_ou_kit;
    const jaPresentes = new Set(
      novoValor.split("|").map((f) => normalizeLower(f.trim()))
    );
    for (const frase of frases) {
      if (jaPresentes.has(normalizeLower(frase))) continue;
      novoValor = `${novoValor} | ${frase}`;
      jaPresentes.add(normalizeLower(frase));
    }
    if (novoValor !== row.sku_ou_kit) {
      await sql`UPDATE placas SET sku_ou_kit = ${novoValor} WHERE id = ${row.id}`;
      atualizados.push({ id: row.id, antes: row.sku_ou_kit, depois: novoValor });
    }
  }

  return NextResponse.json({ ok: true, atualizados });
}
