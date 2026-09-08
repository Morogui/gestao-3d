import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEFAULT_PARAMS, GlobalParams, calcularCusto } from "@/lib/custo";
import {
  ConfigPrecificacao,
  DEFAULT_CONFIG_PRECIFICACAO,
  calcularML,
  calcularShopee,
} from "@/lib/precificacao";

export const dynamic = "force-dynamic";

async function ensureTable() {
  await sql`
  CREATE TABLE IF NOT EXISTS precificacao_produtos (
  id SERIAL PRIMARY KEY,
  produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  peso_envio_kg NUMERIC,
  preco_venda_ml NUMERIC,
  preco_venda_shopee NUMERIC,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(produto_id)
  )
  `;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS enviado_por_flex_ml BOOLEAN NOT NULL DEFAULT false`;
  // 04/09/2026 -- embalagem e margem desejada deixaram de ser um valor
// unico global (precificacao_config) e viraram um override por
// produto aqui. Null = usa o default calculado em embalagemPadrao()
// / a margem real do preco atual.
await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS embalagem_custo NUMERIC`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS margem_desejada_pct NUMERIC`;
  // 04/09/2026 -- Guilherme apontou que varias placas do catalogo sao
// "componentes" (corpo/gancho separados) ou representam um kit de
// 1/2/3 pecas (ex: Coelho, Ganchos Bonito) numa unica linha. O custo
// calculado a partir da placa (custoUnitario) e o custo de 1 peca
// isolada -- mas o SKU real vendido pode ser um conjunto (corpo +
// gancho, ou kit de N pecas), cujo custo real e a soma/combinacao
// das pecas que compoem esse conjunto, nao o valor de uma peca so.
// Como isso varia caso a caso (nao da pra inferir automaticamente),
// vira um override manual editavel na propria tela, igual ao peso
// de envio: null = usa o valor calculado da placa (peca unica).
await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS custo_producao_manual NUMERIC`;
  // 06/09/2026 -- Guilherme pediu uma forma de marcar um produto como
// "nao vendido" numa plataforma especifica (ML ou Shopee), pra
// diferenciar de "vendido mas sem preco cadastrado ainda". Default
// true (ativo) pra nao esconder nada que ja existia antes disso.
await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS ativo_ml BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS ativo_shopee BOOLEAN NOT NULL DEFAULT true`;
  // 08/09/2026 -- Guilherme apontou que o reembolso do Mercado Envios
// Flex varia por produto (peso/tamanho diferente reembolsa
// diferente) -- deixou de ser um campo unico global
// (precificacao_config.reembolso_flex_ml) e virou um override por
// produto aqui, igual embalagem e margem desejada. Null = usa o
// valor da config geral como default (ver GET abaixo).
await sql`ALTER TABLE precificacao_produtos ADD COLUMN IF NOT EXISTS reembolso_flex_ml NUMERIC`;

// 08/09/2026 -- Guilherme reportou que varios produtos "kit" (ex:
// "Gancho Branco (kit 1/2/3)", "Ganchos Bonito (kit 1/2/3)") nunca
// mostravam preco/margem na tela: a lista de produtos aqui sempre
// veio so da tabela `produtos` (a calculadora de custo da aba Custo,
// com 1 linha por placa base) -- mas o SKU REAL vendido pra esses
// kits (ex: a versao de 2 ou 3 unidades) so existe em `sku_placa`
// (usada pela aba Produtos/Full pra compor kits a partir de pecas),
// nunca em `produtos`. Essa tabela guarda o override de
// preco/embalagem/margem/etc de cada um desses SKUs "virtuais"
// (SKUs reais que nao tem uma linha propria em `produtos`), pelo SKU
// como chave em vez de um produto_id -- nao da pra usar
// precificacao_produtos.produto_id porque esse SKU nao tem uma linha
// correspondente em `produtos` (nao tem FK possivel).
await sql`
CREATE TABLE IF NOT EXISTS precificacao_sku_virtual (
id SERIAL PRIMARY KEY,
sku TEXT UNIQUE NOT NULL,
peso_envio_kg NUMERIC,
preco_venda_ml NUMERIC,
preco_venda_shopee NUMERIC,
enviado_por_flex_ml BOOLEAN NOT NULL DEFAULT false,
embalagem_custo NUMERIC,
margem_desejada_pct NUMERIC,
custo_producao_manual NUMERIC,
reembolso_flex_ml NUMERIC,
ativo_ml BOOLEAN NOT NULL DEFAULT true,
ativo_shopee BOOLEAN NOT NULL DEFAULT true,
atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
)
`;
}

type ProdutoRow = {
  id: number;
  nome: string;
  sku: string | null;
  peso_placa_g: string;
  tempo_placa_h: string;
  pecas_na_placa: string;
};

type OverrideRow = {
  produto_id: number;
  peso_envio_kg: string | null;
  preco_venda_ml: string | null;
  preco_venda_shopee: string | null;
  enviado_por_flex_ml: boolean | null;
  embalagem_custo: string | null;
  margem_desejada_pct: string | null;
  custo_producao_manual: string | null;
  ativo_ml: boolean | null;
  ativo_shopee: boolean | null;
  reembolso_flex_ml: string | null;
};

// Uma linha de sku_placa (SKU real de venda -> placa componente +
// quantas pecas dela por unidade vendida). Ver nota grande acima e em
// app/produtos/page.tsx / app/api/produtos/catalogo/route.ts, onde
// esse mesmo cruzamento ja existe pra aba "Produtos".
type SkuPlacaRow = {
  sku: string;
  pecas_por_unidade: string;
  peso_placa_gramas: string | null;
  tempo_placa_horas: string;
  pecas_por_placa: string;
};

type SkuVirtualOverrideRow = {
  id: number;
  sku: string;
  peso_envio_kg: string | null;
  preco_venda_ml: string | null;
  preco_venda_shopee: string | null;
  enviado_por_flex_ml: boolean | null;
  embalagem_custo: string | null;
  margem_desejada_pct: string | null;
  custo_producao_manual: string | null;
  ativo_ml: boolean | null;
  ativo_shopee: boolean | null;
  reembolso_flex_ml: string | null;
};

type ParametrosRow = {
  preco_filamento_kg: string;
  energia_hora: string;
  manutencao_hora: string;
  falha_impressao: string;
};

type ConfigRow = {
  imposto_pct: string;
  ads_pct_ml: string;
  ads_pct_shopee: string;
  afiliado_pct_shopee: string;
  embalagem_custo: string;
  margem_desejada_pct: string;
  reembolso_flex_ml: string;
  custo_flex_ml: string;
};

function normalizarTexto(s: string): string {
  return s
  .toLowerCase()
  .normalize("NFD")
.replace(/[̀-ͯ]/g, "")
    .trim();
}

// Custo padrao de embalagem por produto. A maioria usa uma caixa de
// R$1,10 -- mas Stam-01, Stam-02 e o Suporte Coracao (Suporte para
// Garrafa Coracao) precisam de uma caixa maior/mais cara, R$1,95.
// Confirmado pelo Guilherme em 04/09/2026. Isso e so o valor inicial:
// fica editavel por produto na tela e o Guilherme pode ajustar
// qualquer um individualmente (o ajuste manual vira um override em
// precificacao_produtos.embalagem_custo e passa a valer sobre este
// default).
function embalagemPadrao(nome: string, sku: string | null): number {
  const alvo = normalizarTexto(`${nome} ${sku ?? ""}`);
  if (alvo.includes("stam-01") || alvo.includes("stam 01")) return 1.95;
  if (alvo.includes("stam-02") || alvo.includes("stam 02")) return 1.95;
  if (alvo.includes("coracao")) return 1.95;
  return 1.1;
}

interface ProdutoPrecificacaoResposta {
  id: number;
  nome: string;
  sku: string;
  custoProducao: number;
  custoProducaoCalculado: number;
  pesoEnvioKg: number;
  embalagemCusto: number;
  margemDesejadaPct: number;
  reembolsoFlexML: number;
  precoVendaML: number | null;
  precoVendaShopee: number | null;
  enviadoPorFlexML: boolean;
  ativoML: boolean;
  ativoShopee: boolean;
  resultadoML: ReturnType<typeof calcularML> | null;
  resultadoShopee: ReturnType<typeof calcularShopee> | null;
}

export async function GET() {
  await ensureTable();

const produtosBrutos = (await sql`
SELECT id, nome, sku, peso_placa_g, tempo_placa_h, pecas_na_placa
FROM produtos ORDER BY nome ASC
`) as ProdutoRow[];
  // 08/09/2026 (v3) -- Guilherme apontou que a tela de Precificacao
  // ainda mostrava placas "componente" (ex: "Suporte BMW - Corpos+
  // Ganchos (placa mista)", "Suporte Carregador BYD - Ganchos (placa
  // pura)") como se cada pedaco fosse um produto vendavel separado,
  // com sku = "Componente: corpo do X" / "Componente: gancho do X".
  // Essas linhas sao so a placa isolada usada internamente pra montar
  // o custo do produto composto real -- nunca sao o SKU que de fato
  // existe cadastrado no ML/Shopee. A regra: Precificacao so pode
  // mostrar produtos com o SKU REAL de venda (o que ja temos
  // cadastrado certo no ML/Shopee), nunca a placa/componente isolado.
  // 08/09/2026 (v4) -- placa "componente isolado" (ex: "Suporte Carregador BYD - Corpos (Prata)") tambem tem que ser excluida mesmo quando o sku dela nao comeca com "componente:" -- o padrao real e o NOME da placa seguir a convencao " - Corpos"/" - Ganchos" usada em todo o catalogo pra placas que imprimem SO uma parte do produto composto (nunca vendidas sozinhas). Nao exclui "- Mista" (essa e a placa que imprime corpo+gancho juntos e PODE ser o produto vendavel de verdade).
  const RE_PLACA_COMPONENTE_ISOLADA = /-\s*(corpos?|ganchos?)\b/i;
  const produtos = produtosBrutos.filter((p) => {
    const skuLower = (p.sku ?? "").trim().toLowerCase();
    if (skuLower.startsWith("componente:")) return false;
    if (RE_PLACA_COMPONENTE_ISOLADA.test(p.nome ?? "")) return false;
    return true;
  });

const overrides = (await sql`
SELECT produto_id, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml
FROM precificacao_produtos
`) as OverrideRow[];
  const overrideMap = new Map(overrides.map((o) => [o.produto_id, o]));

const paramRows = (await sql`
SELECT preco_filamento_kg, energia_hora, manutencao_hora, falha_impressao
FROM parametros_globais ORDER BY id DESC LIMIT 1
`) as ParametrosRow[];
  const params: GlobalParams = paramRows.length
  ? {
    precoFilamentoKg: Number(paramRows[0].preco_filamento_kg),
    energiaHora: Number(paramRows[0].energia_hora),
    manutencaoHora: Number(paramRows[0].manutencao_hora),
    falhaImpressao: Number(paramRows[0].falha_impressao),
  }
    : DEFAULT_PARAMS;

const configRows = (await sql`
SELECT imposto_pct, ads_pct_ml, ads_pct_shopee, afiliado_pct_shopee, embalagem_custo, margem_desejada_pct, reembolso_flex_ml, custo_flex_ml
FROM precificacao_config ORDER BY id DESC LIMIT 1
`) as ConfigRow[];
  const config: ConfigPrecificacao = configRows.length
  ? {
    impostoPct: Number(configRows[0].imposto_pct),
    adsPctML: Number(configRows[0].ads_pct_ml),
    adsPctShopee: Number(configRows[0].ads_pct_shopee),
    afiliadoPctShopee: Number(configRows[0].afiliado_pct_shopee),
    embalagemCusto: Number(configRows[0].embalagem_custo),
    margemDesejadaPct: Number(configRows[0].margem_desejada_pct),
    reembolsoFlexML: Number(configRows[0].reembolso_flex_ml),
    custoFlexML: Number(configRows[0].custo_flex_ml),
  }
    : DEFAULT_CONFIG_PRECIFICACAO;

const resultado: ProdutoPrecificacaoResposta[] = produtos.map((p) => {
  const custoCalculado = calcularCusto(
    {
      pesoPlacaG: Number(p.peso_placa_g),
      tempoPlacaH: Number(p.tempo_placa_h),
      pecasNaPlaca: Number(p.pecas_na_placa),
    },
    params
    );

                                                              const override = overrideMap.get(p.id);
  const pecas = Number(p.pecas_na_placa) || 1;
  const pesoEnvioPadrao = Number(p.peso_placa_g) / pecas / 1000;
  const pesoEnvioKg =
    override?.peso_envio_kg != null
  ? Number(override.peso_envio_kg)
    : pesoEnvioPadrao;
  const custoProducao =
    override?.custo_producao_manual != null
  ? Number(override.custo_producao_manual)
    : custoCalculado.custoUnitario;
  const precoVendaML =
    override?.preco_venda_ml != null ? Number(override.preco_venda_ml) : null;
  const precoVendaShopee =
    override?.preco_venda_shopee != null
  ? Number(override.preco_venda_shopee)
    : null;
  const enviadoPorFlexML = override?.enviado_por_flex_ml === true;
  const embalagemCusto =
    override?.embalagem_custo != null
  ? Number(override.embalagem_custo)
    : embalagemPadrao(p.nome, p.sku);
  const reembolsoFlexML =
    override?.reembolso_flex_ml != null
  ? Number(override.reembolso_flex_ml)
    : config.reembolsoFlexML;
  const ativoML = override?.ativo_ml !== false;
  const ativoShopee = override?.ativo_shopee !== false;

                                                              const resultadoML =
                                                                precoVendaML != null
  ? calcularML(precoVendaML, pesoEnvioKg, custoProducao, embalagemCusto, reembolsoFlexML, config, enviadoPorFlexML)
                                                                : null;
  const resultadoShopee =
    precoVendaShopee != null
  ? calcularShopee(precoVendaShopee, custoProducao, embalagemCusto, config)
    : null;

                                                              // Margem desejada agora e por produto: se ainda nao foi ajustada a
                                                              // mao, vem pre-preenchida com a margem REAL do preco anunciado
                                                              // agora (ML tem prioridade sobre Shopee se os dois existirem) --
                                                              // e so cai no valor generico da config antiga se o produto ainda
                                                              // nao tem nenhum preco de venda cadastrado.
                                                              const margemDesejadaPct =
                                                                override?.margem_desejada_pct != null
  ? Number(override.margem_desejada_pct)
                                                                : Math.round((resultadoML?.margemPct ?? resultadoShopee?.margemPct ?? config.margemDesejadaPct) * 10) / 10;

                                                              return {
                                                                id: p.id,
                                                                nome: p.nome,
                                                                sku: p.sku ?? "",
                                                                custoProducao,
                                                                custoProducaoCalculado: custoCalculado.custoUnitario,
                                                                pesoEnvioKg,
                                                                embalagemCusto,
                                                                margemDesejadaPct,
                                                                reembolsoFlexML,
                                                                precoVendaML,
                                                                precoVendaShopee,
                                                                enviadoPorFlexML,
                                                                ativoML,
                                                                ativoShopee,
                                                                resultadoML,
                                                                resultadoShopee,
                                                              };
});
  // --- SKUs "kit"/compostos que so existem em sku_placa (ver nota
// grande em ensureTable acima). Monta uma linha propria pra cada um,
// com o custo de producao somado a partir das placas componentes x
// pecas por unidade -- exatamente a composicao que ja e usada pra
// montar kits na aba Produtos/Full, so que agora tambem precificada.
const skuJaEmProdutos = new Set(
  produtos
  .map((p) => (p.sku ? normalizarTexto(p.sku) : null))
  .filter((s): s is string => !!s)
  );

const linhasSkuPlaca = (await sql`
SELECT sp.sku, sp.pecas_por_unidade,
pl.peso_placa_gramas, pl.tempo_placa_horas, pl.pecas_por_placa
FROM sku_placa sp
JOIN placas pl ON pl.id = sp.placa_id
WHERE pl.descontinuada = false
`) as SkuPlacaRow[];

const composicaoPorSku = new Map<
  string,
{ skuOriginal: string; custoProducao: number; pesoEnvioKg: number }
  >();
  for (const linha of linhasSkuPlaca) {
    const chave = normalizarTexto(linha.sku);
    if (skuJaEmProdutos.has(chave)) continue; // ja tem linha propria via `produtos`, nao duplica
    // 08/09/2026 (v2) -- algumas linhas de sku_placa usam o item_id do
    // Mercado Livre (ex: "MLB6841541452") como SKU: nao sao SKUs reais
    // de venda, sao so uma chave auxiliar criada pra ajudar o
    // casamento pedido->placa quando o titulo do anuncio era ambiguo
    // (ver rotas admin/registrar-item-ids-ambiguos*). O Guilherme
    // apontou que isso vazava pra tela de Precificacao como se fosse
    // um produto de verdade (nome/sku = "MLB..."), o que nao faz
    // sentido -- o produto real ja e precificado pela placa/SKU
    // verdadeiro. Pula essas linhas aqui.
    if (/^mlb\d+$/i.test(linha.sku.trim())) continue;
    // 08/09/2026 (v3) -- mesma logica pro caso reportado pelo Guilherme
    // com o SKU "58259211611": nenhum SKU real da Morolar e 100%
    // numerico (todos tem letras/hifen, ex: "STAM-01", "SUPORTE 6
    // PRATOS BRANCO") -- entao um sku_placa.sku so com digitos tambem
    // e uma chave auxiliar de matching (ean/codigo de barras/item
    // ambiguo), nao um produto de verdade. Pula do mesmo jeito.
    if (/^\d+$/.test(linha.sku.trim())) continue;
  const pecasPorPlaca = Number(linha.pecas_por_placa) || 1;
    const custoUnitarioPlaca = calcularCusto(
      {
        pesoPlacaG: Number(linha.peso_placa_gramas ?? 0),
        tempoPlacaH: Number(linha.tempo_placa_horas),
        pecasNaPlaca: pecasPorPlaca,
      },
      params
      ).custoUnitario;
    const pecasPorUnidade = Number(linha.pecas_por_unidade) || 1;
    const pesoUnitarioPlacaKg =
      (Number(linha.peso_placa_gramas ?? 0) / pecasPorPlaca) / 1000;

  const acumulado = composicaoPorSku.get(chave) ?? {
    skuOriginal: linha.sku,
    custoProducao: 0,
    pesoEnvioKg: 0,
  };
    acumulado.custoProducao += custoUnitarioPlaca * pecasPorUnidade;
    acumulado.pesoEnvioKg += pesoUnitarioPlacaKg * pecasPorUnidade;
    composicaoPorSku.set(chave, acumulado);
  }

if (composicaoPorSku.size > 0) {
  // Garante uma linha em precificacao_sku_virtual pra cada SKU
  // composto encontrado (upsert idempotente), pra ter um id estavel
  // pra usar como chave/React key no front -- sem isso cada GET
  // geraria um id novo e a tela perderia o "produto.id" pra salvar
  // os overrides de volta.
  for (const { skuOriginal } of composicaoPorSku.values()) {
    await sql`
    INSERT INTO precificacao_sku_virtual (sku)
    VALUES (${skuOriginal})
    ON CONFLICT (sku) DO NOTHING
    `;
  }
}

const virtuaisOverrides = composicaoPorSku.size
  ? ((await sql`
  SELECT id, sku, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml
  FROM precificacao_sku_virtual
  `) as SkuVirtualOverrideRow[])
  : [];
  const virtualOverrideMap = new Map(
    virtuaisOverrides.map((v) => [normalizarTexto(v.sku), v])
    );

const resultadoVirtual: ProdutoPrecificacaoResposta[] = Array.from(
  composicaoPorSku.entries()
  ).map(([chave, calc]) => {
  const override = virtualOverrideMap.get(chave);
  const custoProducaoCalculado = calc.custoProducao;
  const custoProducao =
    override?.custo_producao_manual != null
  ? Number(override.custo_producao_manual)
    : custoProducaoCalculado;
  const pesoEnvioKg =
    override?.peso_envio_kg != null
  ? Number(override.peso_envio_kg)
    : calc.pesoEnvioKg;
  const precoVendaML =
    override?.preco_venda_ml != null ? Number(override.preco_venda_ml) : null;
  const precoVendaShopee =
    override?.preco_venda_shopee != null
  ? Number(override.preco_venda_shopee)
    : null;
  const enviadoPorFlexML = override?.enviado_por_flex_ml === true;
  const embalagemCusto =
    override?.embalagem_custo != null
  ? Number(override.embalagem_custo)
    : embalagemPadrao(calc.skuOriginal, calc.skuOriginal);
  const reembolsoFlexML =
    override?.reembolso_flex_ml != null
  ? Number(override.reembolso_flex_ml)
    : config.reembolsoFlexML;
  const ativoML = override?.ativo_ml !== false;
  const ativoShopee = override?.ativo_shopee !== false;

        const resultadoML =
          precoVendaML != null
  ? calcularML(precoVendaML, pesoEnvioKg, custoProducao, embalagemCusto, reembolsoFlexML, config, enviadoPorFlexML)
          : null;
  const resultadoShopee =
    precoVendaShopee != null
  ? calcularShopee(precoVendaShopee, custoProducao, embalagemCusto, config)
    : null;

        const margemDesejadaPct =
          override?.margem_desejada_pct != null
  ? Number(override.margem_desejada_pct)
          : Math.round((resultadoML?.margemPct ?? resultadoShopee?.margemPct ?? config.margemDesejadaPct) * 10) / 10;

        // ids negativos (a partir do id serial de precificacao_sku_virtual)
        // pra nunca colidir com os ids positivos de `produtos` -- o PUT
        // abaixo usa esse sinal pra saber em qual tabela salvar de volta.
        const idVirtual = override ? -override.id : 0;

        return {
          id: idVirtual,
          nome: calc.skuOriginal,
          sku: calc.skuOriginal,
          custoProducao,
          custoProducaoCalculado,
          pesoEnvioKg,
          embalagemCusto,
          margemDesejadaPct,
          reembolsoFlexML,
          precoVendaML,
          precoVendaShopee,
          enviadoPorFlexML,
          ativoML,
          ativoShopee,
          resultadoML,
          resultadoShopee,
        };
});

return NextResponse.json(
  [...resultado, ...resultadoVirtual].sort((a, b) => a.nome.localeCompare(b.nome))
  );
}
export async function PUT(request: NextRequest) {
  await ensureTable();
  const body = await request.json();
  const {
    produtoId,
    sku,
    pesoEnvioKg,
    precoVendaML,
    precoVendaShopee,
    enviadoPorFlexML,
    embalagemCusto,
    margemDesejadaPct,
    custoProducao,
    ativoML,
    ativoShopee,
    reembolsoFlexML,
  } = body as {
    produtoId: number;
    sku?: string | null;
    pesoEnvioKg: number | null;
    precoVendaML: number | null;
    precoVendaShopee: number | null;
    enviadoPorFlexML: boolean | null;
    embalagemCusto: number | null;
    margemDesejadaPct: number | null;
    custoProducao: number | null;
    ativoML: boolean | null;
    ativoShopee: boolean | null;
    reembolsoFlexML: number | null;
  };

if (produtoId == null) {
  return NextResponse.json({ error: "produtoId e obrigatorio" }, { status: 400 });
}

const ativoMLFinal = ativoML !== false;
  const ativoShopeeFinal = ativoShopee !== false;

// id negativo = linha "virtual" (SKU composto que so existe em
// sku_placa, sem linha propria em `produtos` -- ver GET acima).
// Salva em precificacao_sku_virtual, pelo SKU como chave.
if (produtoId < 0) {
  if (!sku) {
    return NextResponse.json({ error: "sku e obrigatorio para produtos compostos" }, { status: 400 });
  }
  await sql`
  INSERT INTO precificacao_sku_virtual (sku, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, reembolso_flex_ml, ativo_ml, ativo_shopee, atualizado_em)
  VALUES (${sku}, ${pesoEnvioKg}, ${precoVendaML}, ${precoVendaShopee}, ${enviadoPorFlexML === true}, ${embalagemCusto}, ${margemDesejadaPct}, ${custoProducao}, ${reembolsoFlexML}, ${ativoMLFinal}, ${ativoShopeeFinal}, now())
  ON CONFLICT (sku) DO UPDATE
  SET peso_envio_kg = ${pesoEnvioKg},
  preco_venda_ml = ${precoVendaML},
  preco_venda_shopee = ${precoVendaShopee},
  enviado_por_flex_ml = ${enviadoPorFlexML === true},
  embalagem_custo = ${embalagemCusto},
  margem_desejada_pct = ${margemDesejadaPct},
  custo_producao_manual = ${custoProducao},
  reembolso_flex_ml = ${reembolsoFlexML},
  ativo_ml = ${ativoMLFinal},
  ativo_shopee = ${ativoShopeeFinal},
  atualizado_em = now()
  `;
  return NextResponse.json({ ok: true });
}

await sql`
INSERT INTO precificacao_produtos (produto_id, peso_envio_kg, preco_venda_ml, preco_venda_shopee, enviado_por_flex_ml, embalagem_custo, margem_desejada_pct, custo_producao_manual, ativo_ml, ativo_shopee, reembolso_flex_ml, atualizado_em)
VALUES (${produtoId}, ${pesoEnvioKg}, ${precoVendaML}, ${precoVendaShopee}, ${enviadoPorFlexML === true}, ${embalagemCusto}, ${margemDesejadaPct}, ${custoProducao}, ${ativoMLFinal}, ${ativoShopeeFinal}, ${reembolsoFlexML}, now())
ON CONFLICT (produto_id) DO UPDATE
SET peso_envio_kg = ${pesoEnvioKg},
preco_venda_ml = ${precoVendaML},
preco_venda_shopee = ${precoVendaShopee},
enviado_por_flex_ml = ${enviadoPorFlexML === true},
embalagem_custo = ${embalagemCusto},
margem_desejada_pct = ${margemDesejadaPct},
custo_producao_manual = ${custoProducao},
ativo_ml = ${ativoMLFinal},
ativo_shopee = ${ativoShopeeFinal},
reembolso_flex_ml = ${reembolsoFlexML},
atualizado_em = now()
`;

return NextResponse.json({ ok: true });
}
