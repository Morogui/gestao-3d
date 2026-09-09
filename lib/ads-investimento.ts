// Registro manual de investimento diário em Ads (Mercado Ads / Shopee
// Ads) — pedido do Guilherme em 2026-09-08: "um campo onde mostre o
// investimento de Ads por dia... geral, shopee e mercado livre e eles
// separados".
//
// Por que é manual e não puxa direto da API: hoje o sistema não tem
// nenhuma integração com Mercado Ads nem Shopee Ads (isso ainda está
// pendente — ver registro em ads-roas-registro.md, que hoje é mantido só
// como anotação de texto). Puxar o gasto automaticamente exigiria APIs
// de Ads separadas das APIs de pedidos (com seus próprios escopos de
// autenticação), que ainda não foram integradas. Enquanto isso não
// acontece, este arquivo guarda o valor que o Guilherme digitar
// manualmente (ele já confere esse número todo dia direto no painel de
// cada plataforma) — pelo menos fica registrado e histórico no sistema,
// em vez de só na cabeça dele.
import { sql } from "./db";

export interface AdsInvestimentoDia {
  dia: string; // YYYY-MM-DD
  ml: number;
  shopee: number;
}

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS ads_investimento_diario (
      id SERIAL PRIMARY KEY,
      dia DATE NOT NULL,
      plataforma TEXT NOT NULL CHECK (plataforma IN ('ml', 'shopee')),
      valor NUMERIC NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(dia, plataforma)
    )
  `;
}

interface Row {
  dia: string;
  ml: string | null;
  shopee: string | null;
}

// Soma o investimento em Ads (ML + Shopee, separado) num intervalo de
// dias — usada pro card de "Investimento em Ads" respeitar o mesmo
// filtro de data já escolhido na aba Vendas.
export async function getAdsInvestimentoRange(
  fromDay: string,
  toDay: string
): Promise<{ ml: number; shopee: number; porDia: AdsInvestimentoDia[] }> {
  await ensureTable();
  const rows = (await sql`
    SELECT
      dia::text AS dia,
      SUM(CASE WHEN plataforma = 'ml' THEN valor ELSE 0 END)::float8 AS ml,
      SUM(CASE WHEN plataforma = 'shopee' THEN valor ELSE 0 END)::float8 AS shopee
    FROM ads_investimento_diario
    WHERE dia >= ${fromDay}::date AND dia <= ${toDay}::date
    GROUP BY dia
    ORDER BY dia ASC
  `) as Row[];

  const porDia = rows.map((r) => ({
    dia: r.dia,
    ml: Number(r.ml ?? 0),
    shopee: Number(r.shopee ?? 0),
  }));
  const ml = porDia.reduce((s, r) => s + r.ml, 0);
  const shopee = porDia.reduce((s, r) => s + r.shopee, 0);
  return { ml, shopee, porDia };
}

// Valor já salvo pra um dia específico (usado pra pré-preencher o
// formulário de "registrar hoje" com o que já tiver sido lançado).
export async function getAdsInvestimentoDoDia(
  dia: string
): Promise<{ ml: number; shopee: number }> {
  await ensureTable();
  const rows = (await sql`
    SELECT plataforma, valor::float8 AS valor
    FROM ads_investimento_diario
    WHERE dia = ${dia}::date
  `) as { plataforma: string; valor: number }[];
  let ml = 0;
  let shopee = 0;
  for (const r of rows) {
    if (r.plataforma === "ml") ml = r.valor;
    if (r.plataforma === "shopee") shopee = r.valor;
  }
  return { ml, shopee };
}

export async function salvarAdsInvestimentoDoDia(
  dia: string,
  ml: number,
  shopee: number
): Promise<void> {
  await ensureTable();
  await sql`
    INSERT INTO ads_investimento_diario (dia, plataforma, valor, atualizado_em)
    VALUES (${dia}::date, 'ml', ${ml}, now())
    ON CONFLICT (dia, plataforma) DO UPDATE SET valor = ${ml}, atualizado_em = now()
  `;
  await sql`
    INSERT INTO ads_investimento_diario (dia, plataforma, valor, atualizado_em)
    VALUES (${dia}::date, 'shopee', ${shopee}, now())
    ON CONFLICT (dia, plataforma) DO UPDATE SET valor = ${shopee}, atualizado_em = now()
  `;
}
