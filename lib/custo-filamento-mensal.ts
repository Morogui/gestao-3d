import { sql } from "./db";
import { calcularCusto, GlobalParams } from "./custo";

// Custo medio mensal de filamento - pedido do Guilherme em 2026-08-14:
// "o custo medio do mes sempre tem que ir ajustando e gravando o custo,
// para ter controle de qual a media mensal do nosso filamento para custo
// dos produtos" + "atualizar automaticamente e ja atualizar os custos
// dos meus produtos e salvar cada sku com mudanca e data, para ter uma
// dre completa". Reinicia todo mes: so entram nessa media as compras
// cujo data_chegada caiu dentro do mes corrente (chegou = true) - meses
// anteriores nao pesam, cada mes calcula do zero. Disparado a cada
// confirmacao de chegada de filamento (POST/PATCH/DELETE em
// /api/financeiro/compras-filamento), nao por cron.
async function garantirTabelas() {
    await sql`
        CREATE TABLE IF NOT EXISTS custo_filamento_mensal (
              id SERIAL PRIMARY KEY,
                    mes TEXT NOT NULL UNIQUE,
                          total_gramas NUMERIC NOT NULL,
                                total_valor NUMERIC NOT NULL,
                                      custo_medio_kg NUMERIC NOT NULL,
                                            custo_medio_por_cor JSONB,
                                                  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                                                      )
                                                        `;
    await sql`
        CREATE TABLE IF NOT EXISTS custo_produto_historico (
              id SERIAL PRIMARY KEY,
                    produto_id INTEGER NOT NULL,
                          sku TEXT,
                                nome TEXT NOT NULL,
                                      custo_unitario NUMERIC NOT NULL,
                                            custo_filamento_kg NUMERIC NOT NULL,
                                                  mes_referencia TEXT NOT NULL,
                                                        data DATE NOT NULL DEFAULT CURRENT_DATE,
                                                              criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
                                                                  )
                                                                    `;
}

export interface ResultadoRecalculoMensal {
    mes: string;
    custoMedioKg: number;
    produtosAtualizados: number;
}

export async function recalcularCustoFilamentoMensal(): Promise<ResultadoRecalculoMensal | null> {
    await garantirTabelas();

  const hoje = new Date();
    const ano = hoje.getUTCFullYear();
    const mesNum = hoje.getUTCMonth();
    const mes = `${ano}-${String(mesNum + 1).padStart(2, "0")}`;
    const mesInicio = `${mes}-01`;
    const prox = new Date(Date.UTC(ano, mesNum + 1, 1));
    const mesFim = `${prox.getUTCFullYear()}-${String(prox.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const compras = (await sql`
      SELECT cor, gramas, valor_pago
          FROM compras_filamento
              WHERE chegou = true AND data_chegada >= ${mesInicio} AND data_chegada < ${mesFim}
                `) as { cor: string; gramas: string; valor_pago: string }[];

  const totalGramas = compras.reduce((s, c) => s + Number(c.gramas), 0);
    const totalValor = compras.reduce((s, c) => s + Number(c.valor_pago), 0);

  // Sem nenhuma compra chegada nesse mes ainda - nao ha o que recalcular
  // (evita zerar o preco do filamento por falta de dado; o parametro
  // global mantem o ultimo valor conhecido ate a primeira compra do mes
  // chegar).
  if (totalGramas <= 0) return null;

  const custoMedioKg = (totalValor / totalGramas) * 1000;

  const porCor = new Map<string, { gramas: number; valor: number }>();
    for (const c of compras) {
          const atual = porCor.get(c.cor) ?? { gramas: 0, valor: 0 };
          atual.gramas += Number(c.gramas);
          atual.valor += Number(c.valor_pago);
          porCor.set(c.cor, atual);
    }
    const custoMedioPorCor: Record<string, number> = {};
    for (const [cor, dados] of porCor) {
          if (dados.gramas > 0) custoMedioPorCor[cor] = (dados.valor / dados.gramas) * 1000;
    }
    const custoMedioPorCorJson = JSON.stringify(custoMedioPorCor);

  await sql`
      INSERT INTO custo_filamento_mensal (mes, total_gramas, total_valor, custo_medio_kg, custo_medio_por_cor, atualizado_em)
          VALUES (${mes}, ${totalGramas}, ${totalValor}, ${custoMedioKg}, ${custoMedioPorCorJson}::jsonb, now())
              ON CONFLICT (mes) DO UPDATE
                  SET total_gramas = ${totalGramas}, total_valor = ${totalValor}, custo_medio_kg = ${custoMedioKg},
                          custo_medio_por_cor = ${custoMedioPorCorJson}::jsonb, atualizado_em = now()
                            `;

  // Propaga pro parametro global usado em todo o calculo de custo
  // (lib/custo.ts) - e esse valor que a aba Custo mostra e usa.
  const paramRows = (await sql`
      SELECT id, preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
          FROM parametros_globais
              ORDER BY id DESC LIMIT 1
                `) as { id: number; preco_filamento_kg: string; energia_hora: string; manutencao_hora: string; falha_impressao: string }[];

  const params: GlobalParams = {
        precoFilamentoKg: custoMedioKg,
        energiaHora: paramRows.length > 0 ? Number(paramRows[0].energia_hora) : 0.08,
        manutencaoHora: paramRows.length > 0 ? Number(paramRows[0].manutencao_hora) : 0.3,
        falhaImpressao: paramRows.length > 0 ? Number(paramRows[0].falha_impressao) : 0.03,
  };

  if (paramRows.length > 0) {
        await sql`
              UPDATE parametros_globais
                    SET preco_filamento_kg = ${custoMedioKg}, atualizado_em = now()
                          WHERE id = ${paramRows[0].id}
                              `;
  } else {
        await sql`
              INSERT INTO parametros_globais (preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao)
                    VALUES (${custoMedioKg}, ${params.energiaHora}, ${params.manutencaoHora}, ${params.falhaImpressao})
                        `;
  }

  // Recalcula o custo unitario de cada produto cadastrado (aba Custo) e
  // so registra uma linha nova no historico quando o valor de fato muda
  // (evita poluir a tabela com linhas identicas a cada recompra) - essa
  // tabela e a base pra montar a DRE (custo por SKU ao longo do tempo).
  const produtos = (await sql`
      SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
          FROM produtos
            `) as { id: number; nome: string; sku: string | null; peso_placa_g: string; tempo_placa_h: string; pecas_na_placa: string }[];

  let produtosAtualizados = 0;
    for (const p of produtos) {
          const custo = calcularCusto(
            {
                      pesoPlacaG: Number(p.peso_placa_g),
                      tempoPlacaH: Number(p.tempo_placa_h),
                      pecasNaPlaca: Number(p.pecas_na_placa),
            },
                  params
                );

      const ultimo = (await sql`
            SELECT custo_unitario FROM custo_produto_historico
                  WHERE produto_id = ${p.id}
                        ORDER BY criado_em DESC LIMIT 1
                            `) as { custo_unitario: string }[];

      const custoAnterior = ultimo.length > 0 ? Number(ultimo[0].custo_unitario) : null;
          const mudou = custoAnterior === null || Math.abs(custoAnterior - custo.custoUnitario) > 0.0001;

      if (mudou) {
              await sql`
                      INSERT INTO custo_produto_historico (produto_id, sku, nome, custo_unitario, custo_filamento_kg, mes_referencia, data)
                              VALUES (${p.id}, ${p.sku}, ${p.nome}, ${custo.custoUnitario}, ${custoMedioKg}, ${mes}, CURRENT_DATE)
                                    `;
              produtosAtualizados++;
      }
    }

  return { mes, custoMedioKg, produtosAtualizados };
}
