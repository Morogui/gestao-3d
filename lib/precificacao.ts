// Logica de calculo de precificacao por plataforma (Mercado Livre e Shopee).
//
// Baseado em auditoria de dados reais feita em 19/08/2026 direto na
// Central de Vendedores do ML e no seller center da Shopee (nao em
// blogs/tabelas genericas) -- ver planilha "PRECIFICACAO CERTA" pra
// contexto completo da investigacao.
//
// Pontos ainda pendentes de confirmacao do Guilherme (ficam com valor
// default editavel na config, mas nao sao um calculo "fechado" ainda):
// - % de comissao de afiliados na Shopee (se ele participar do programa)
// - aliquota exata de imposto (confirmar com a contadora, CF Contabil)
// - custo real do Mercado Envios Flex: Guilherme confirmou que o ML
// reembolsa uma parte e ele tem um custo real que paga pelo Flex --
// default R$0 editavel (config.custoFlexML, ainda global).
//
// Embalagem (04/09/2026): deixou de ser um valor unico global e virou
// um campo por produto (ver precificacao_produtos.embalagem_custo em
// app/api/precificacao/produtos/route.ts) -- por isso calcularML e
// calcularShopee abaixo recebem o custo de embalagem como parametro em
// vez de ler config.embalagemCusto. O campo embalagemCusto continua
// existindo no ConfigPrecificacao so por compatibilidade com registros
// antigos no banco; nao e mais editado nem lido na tela.
//
// Margem desejada (04/09/2026): tambem deixou de ser um valor global e
// virou um campo por produto (precificacao_produtos.margem_desejada_pct),
// pre-preenchido com a margem real do preco anunciado no momento --
// ver app/api/precificacao/produtos/route.ts.
//
// Reembolso Flex ML (08/09/2026): Guilherme apontou que o reembolso que
// o ML da pelo envio Flex varia por produto (peso/tamanho diferente
// reembolsa diferente) -- nao faz sentido ser um unico valor global
// pra conta inteira. Virou um campo por produto tambem
// (precificacao_produtos.reembolso_flex_ml / precificacao_sku_virtual.
// reembolso_flex_ml), igual embalagem e margem desejada. calcularML
// abaixo passa a receber reembolsoFlexML como parametro explicito em
// vez de ler config.reembolsoFlexML. O campo continua existindo em
// ConfigPrecificacao apenas como valor-default de fallback (usado
// quando o produto ainda nao tem um override proprio cadastrado) e por
// compatibilidade com registros antigos no banco -- nao e mais editado
// na secao "Configuracao geral" da tela.
//
// Ads/Afiliado por produto (08/09/2026): Guilherme perguntou se a
// Margem ML/Shopee mostrada ja considerava Ads e Afiliado, e pediu um
// check por produto igual ao do Flex pra poder ver quanto ficaria a
// margem usando cada modalidade. Antes, Ads sempre entrava na conta (fixo,
// sem opcao de desligar) e Afiliado no ML nem existia (sempre 0) --
// so a Shopee tinha afiliado modelado, tambem sempre ligado quando a
// config tinha um % > 0. Agora calcularML/calcularShopee recebem
// usaAdsML/usaAfiliadoML (ML) e usaAdsShopee/usaAfiliadoShopee (Shopee)
// como parametros booleanos explicitos -- o percentual usado continua
// vindo da config geral (adsPctML/adsPctShopee/afiliadoPctML/
// afiliadoPctShopee), so o liga/desliga passou a ser por produto (ver
// as novas colunas em precificacao_produtos/precificacao_sku_virtual).
// Os defaults (usaAdsML=true, usaAfiliadoML=false, usaAdsShopee=true,
// usaAfiliadoShopee=true) foram escolhidos pra preservar exatamente o
// comportamento que a tela ja tinha antes desta mudanca pra qualquer
// produto que ainda nao tiver o override novo salvo.

export interface ConfigPrecificacao {
    impostoPct: number;
    adsPctML: number;
    adsPctShopee: number;
    afiliadoPctML: number;
    afiliadoPctShopee: number;
    embalagemCusto: number;
    margemDesejadaPct: number;
    reembolsoFlexML: number;
    custoFlexML: number;
}

export const DEFAULT_CONFIG_PRECIFICACAO: ConfigPrecificacao = {
    impostoPct: 6,
    adsPctML: 5,
    adsPctShopee: 10,
    afiliadoPctML: 0,
    afiliadoPctShopee: 0,
    embalagemCusto: 1.1,
    margemDesejadaPct: 20,
    reembolsoFlexML: 0,
    custoFlexML: 0,
};

export const COMISSAO_ML_CLASSICO_PCT = 11.5;

export interface CategoriaML {
    nome: string;
    classicoPct: number;
    premiumPct: number;
}

export const CATEGORIAS_ML: CategoriaML[] = [
    { nome: "Casa, Moveis e Decoracao", classicoPct: 11.5, premiumPct: 16.5 },
    { nome: "Acessorios para Veiculos", classicoPct: 11.5, premiumPct: 16.5 },
    { nome: "Celulares e Informatica", classicoPct: 12, premiumPct: 17 },
    { nome: "Eletronicos, Audio e Video", classicoPct: 12, premiumPct: 17 },
    { nome: "Eletrodomesticos", classicoPct: 12.5, premiumPct: 17.5 },
    { nome: "Ferramentas e Construcao", classicoPct: 12.5, premiumPct: 17.5 },
    { nome: "Esporte e Fitness", classicoPct: 13, premiumPct: 18 },
    { nome: "Bebes", classicoPct: 13, premiumPct: 18 },
    { nome: "Papelaria, Arte e Armarinho", classicoPct: 13, premiumPct: 18 },
    { nome: "Brinquedos e Hobbies", classicoPct: 13.5, premiumPct: 18.5 },
    { nome: "Beleza e Cuidado Pessoal", classicoPct: 13.5, premiumPct: 18.5 },
    { nome: "Saude", classicoPct: 13.5, premiumPct: 18.5 },
    { nome: "Calcados, Roupas e Bolsas", classicoPct: 14, premiumPct: 19 },
    ];

export const COMISSAO_ML_PREMIUM_PCT = 16.5;

export function taxaFixaMLSemFreteGratis(preco: number): number {
    if (preco < 12.5) return 0;
    if (preco < 29) return 6.25;
    if (preco < 50) return 6.5;
    if (preco < 79) return 6.75;
    return 0;
}

const FAIXAS_PRECO_ML = [18.99, 48.99, 78.99, 99.99, 119.99, 149.99, 199.99, Infinity];

const FAIXAS_PESO_ML: { ateKg: number; valores: number[] }[] = [
    { ateKg: 0.3, valores: [5.65, 6.85, 8.15, 12.95, 14.95, 16.95, 19.05, 21.65] },
    { ateKg: 0.5, valores: [5.95, 6.95, 8.25, 13.85, 16.15, 18.15, 20.45, 23.25] },
    { ateKg: 1, valores: [6.05, 7.15, 8.45, 14.45, 16.85, 19.05, 21.35, 24.45] },
    { ateKg: 1.5, valores: [6.15, 7.35, 8.65, 14.75, 17.15, 19.45, 21.75, 25.45] },
    { ateKg: 2, valores: [6.25, 7.45, 8.75, 15.05, 17.65, 19.85, 22.25, 25.55] },
    { ateKg: 3, valores: [6.35, 8.65, 9.15, 16.45, 19.15, 21.65, 24.35, 27.05] },
    { ateKg: 4, valores: [6.45, 8.75, 9.75, 17.85, 20.75, 23.35, 26.35, 29.25] },
    { ateKg: 5, valores: [6.55, 8.85, 10.25, 19.75, 22.85, 26.05, 29.25, 32.45] },
    { ateKg: 6, valores: [6.65, 8.95, 10.35, 25.95, 29.15, 33.35, 36.45, 40.85] },
    { ateKg: 7, valores: [6.75, 9.05, 10.45, 27.55, 31.65, 36.75, 40.85, 45.25] },
    { ateKg: 8, valores: [6.85, 9.25, 10.55, 29.45, 34.35, 39.25, 44.15, 49.35] },
    { ateKg: 9, valores: [6.95, 9.35, 10.65, 30.25, 35.25, 40.35, 45.35, 50.75] },
    { ateKg: 10, valores: [7.05, 9.45, 10.85, 38.25, 45.05, 51.95, 58.75, 65.85] },
    { ateKg: 11, valores: [7.05, 9.65, 11.05, 41.65, 48.55, 55.45, 62.35, 69.35] },
    { ateKg: 13, valores: [7.15, 10.05, 11.45, 42.55, 49.75, 56.85, 63.85, 70.95] },
    { ateKg: 15, valores: [7.25, 10.25, 11.65, 45.55, 52.95, 60.55, 68.15, 75.65] },
    { ateKg: 17, valores: [7.35, 10.45, 11.85, 48.95, 56.55, 64.05, 71.35, 79.35] },
    { ateKg: 20, valores: [7.45, 10.65, 12.05, 55.15, 64.35, 73.55, 82.75, 91.95] },
    { ateKg: 25, valores: [7.65, 11.05, 12.25, 64.55, 75.75, 85.45, 96.25, 106.85] },
    { ateKg: 30, valores: [7.75, 11.25, 12.45, 66.45, 76.05, 86.25, 97.15, 107.85] },
    { ateKg: 40, valores: [7.85, 11.45, 12.65, 68.35, 79.65, 89.75, 100.05, 107.95] },
    { ateKg: 50, valores: [7.95, 11.65, 12.85, 70.95, 81.85, 92.85, 103.45, 111.65] },
    { ateKg: 60, valores: [8.05, 11.85, 13.05, 75.55, 87.25, 99.05, 110.25, 119.05] },
    { ateKg: 70, valores: [8.15, 12.05, 13.25, 80.95, 93.75, 105.95, 118.05, 127.45] },
    { ateKg: 80, valores: [8.25, 12.25, 13.45, 84.65, 97.95, 110.75, 123.35, 133.15] },
    { ateKg: 90, valores: [8.35, 12.45, 13.65, 94.05, 108.35, 122.95, 136.95, 147.85] },
    { ateKg: 100, valores: [8.45, 12.65, 13.85, 107.45, 124.85, 140.45, 156.45, 168.85] },
    { ateKg: 125, valores: [8.55, 12.85, 14.05, 120.15, 138.95, 156.95, 174.85, 188.85] },
    { ateKg: 150, valores: [8.65, 12.85, 14.25, 127.45, 147.05, 166.55, 185.55, 200.35] },
    { ateKg: Infinity, valores: [8.75, 12.85, 14.45, 167.05, 193.35, 218.45, 243.45, 262.85] },
    ];

export function taxaPesoML(pesoKg: number, preco: number = 0): number {
    const peso = pesoKg && pesoKg > 0 ? pesoKg : 0.3;
    const faixaPeso = FAIXAS_PESO_ML.find((f) => peso <= f.ateKg) ?? FAIXAS_PESO_ML[FAIXAS_PESO_ML.length - 1];
    let colPreco = FAIXAS_PRECO_ML.findIndex((max) => preco <= max);
    if (colPreco === -1) colPreco = FAIXAS_PRECO_ML.length - 1;
    const valor = faixaPeso.valores[colPreco];
    return preco > 0 && preco < 19 ? Math.min(valor, preco / 2) : valor;
}

export function comissaoShopeePct(preco: number): number {
    return preco < 80 ? 20 : 14;
}

export function taxaFixaShopee(preco: number): number {
    if (preco < 80) return 4;
    if (preco < 100) return 16;
    if (preco < 200) return 20;
    return 26;
}

export interface ResultadoPlataforma {
    preco: number;
    comissao: number;
    taxaFixa: number;
    imposto: number;
    ads: number;
    afiliado: number;
    embalagem: number;
    flexCusto: number;
    custoProducao: number;
    lucro: number;
    margemPct: number;
}

export function calcularML(
    preco: number,
    pesoKg: number,
    custoProducao: number,
    embalagemCusto: number,
    reembolsoFlexML: number,
    config: ConfigPrecificacao,
    enviadoPorFlex: boolean = false,
    usaAdsML: boolean = true,
    usaAfiliadoML: boolean = false
    ): ResultadoPlataforma {
    const comissao = preco * (COMISSAO_ML_CLASSICO_PCT / 100);
    const taxaFixa = taxaPesoML(pesoKg, preco);
    const imposto = preco * (config.impostoPct / 100);
    const ads = usaAdsML ? preco * (config.adsPctML / 100) : 0;
    const afiliado = usaAfiliadoML ? preco * (config.afiliadoPctML / 100) : 0;
    const embalagem = embalagemCusto;
    const flexCusto = enviadoPorFlex ? Math.max(0, config.custoFlexML - reembolsoFlexML) : 0;
    const lucro = preco - comissao - taxaFixa - imposto - ads - afiliado - embalagem - flexCusto - custoProducao;
    const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
    return { preco, comissao, taxaFixa, imposto, ads, afiliado, embalagem, flexCusto, custoProducao, lucro, margemPct };
}

export function calcularShopee(
    preco: number,
    custoProducao: number,
    embalagemCusto: number,
    config: ConfigPrecificacao,
    usaAdsShopee: boolean = true,
    usaAfiliadoShopee: boolean = true
    ): ResultadoPlataforma {
    const comissao = preco * (comissaoShopeePct(preco) / 100);
    const taxaFixa = taxaFixaShopee(preco);
    const imposto = preco * (config.impostoPct / 100);
    const ads = usaAdsShopee ? preco * (config.adsPctShopee / 100) : 0;
    const afiliado = usaAfiliadoShopee ? preco * (config.afiliadoPctShopee / 100) : 0;
    const embalagem = embalagemCusto;
    const lucro = preco - comissao - taxaFixa - imposto - ads - afiliado - embalagem - custoProducao;
    const margemPct = preco > 0 ? (lucro / preco) * 100 : 0;
    return { preco, comissao, taxaFixa, imposto, ads, afiliado, embalagem, flexCusto: 0, custoProducao, lucro, margemPct };
}

export function formatBRL(value: number): string {
    if (Number.isNaN(value) || !Number.isFinite(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
