"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  taxaPesoML,
  taxaFixaMLSemFreteGratis,
  comissaoShopeePct,
  taxaFixaShopee,
  COMISSAO_ML_CLASSICO_PCT,
  COMISSAO_ML_PREMIUM_PCT,
  CATEGORIAS_ML,
  formatBRL,
} from "@/lib/precificacao";
import ThemeToggle from "@/components/ThemeToggle";

// Calculadora de custo e precificacao de impressao 3D - pedido do
// Guilherme em 2026-08-19. Correcao importante feita no mesmo dia: a
// primeira versao desta pagina era um painel de chao de fabrica ligado
// ao nosso banco (maquinas/producoes/placas). Guilherme esclareceu:
// a ideia nao e um painel nosso, mas sim um painel generico igual a
// referencia que te passei para eu poder mandar para meus amigos
// fazerem o custo dos produtos deles - ou seja, essa pagina tem que
// funcionar sozinha, sem nenhuma dependencia do nosso catalogo/estoque/
// maquinas, pra poder ser compartilhada com qualquer pessoa que
// imprima em 3D. Inspirada em renancorreia.com.br/calculadora
// (tema escuro, cards com icone, abas Custos/Precificacao), mas com os
// cards lado a lado em vez de empilhados pra baixo. Inclui, por pedido
// explicito do Guilherme, dois fatores que a referencia nao tinha:
// manutencao da impressora (R$/hora) e falha de impressao (% de
// desperdicio esperado) - ambos entram no custo total de producao.
//
// As formulas de taxa do Mercado Livre e da Shopee em lib/precificacao.ts
// sao puras (sem chamada a banco/API) e ja foram auditadas pelo
// Guilherme direto na Central de Vendedores/seller center em 19/08/2026
// - por isso sao reaproveitadas aqui como estao, so com os percentuais
// de imposto/ads deixados editaveis (cada pessoa tem um regime
// tributario e uma estrategia de anuncios diferente).
//
// 2026-08-20: logo "7x7 Escala Ecommerce" embutida como data-URI no
// header (pedido do Guilherme), e os 8 cards da aba Custos reagrupados
// em 4 (Impressora fica sozinho, os outros 7 campos viraram 3 cards
// tematicos) pra ficar visualmente mais limpo.
//
// 2026-08-21: aba Precificacao Marketplace virou a primeira/padrao (Custo
// Produto 3D passou a ser a 2a aba, pedido do Guilherme), logo aumentada,
// e adicionados: toggle de afiliado (Parceiros) no card do Mercado Livre
// igual ao da Shopee, comparativo de preco vendendo com Flex vs sem Flex,
// e um detalhamento completo das taxas em ambos os cards. A tarifa por
// peso do ML (taxaPesoML) tambem foi atualizada pra tabela oficial
// "Custos para MercadoLideres, com reputacao verde ou sem reputacao"
// (vendedores.mercadolivre.com.br/knowledge-hub/48392), valida a partir
// de 24/08/2026 - ver comentario em lib/precificacao.ts sobre a ressalva
// de reputacao/tier.
//
// 2026-08-21 (2): adicionado modo "Por preco de venda" na Precificacao -
// pedido do Guilherme: antes so dava pra escolher a margem desejada e o
// sistema calculava o preco. Agora ele pode escolher direto o preco que
// quer vender e ver a margem liquida resultante em cada plataforma (o
// mesmo preco e aplicado nas duas, mas a margem final difere porque as
// taxas de ML e Shopee sao diferentes).
//
// 2026-08-27: adicionado toggle de tema claro/escuro (sol/lua) - pedido
// do Guilherme. A pagina inteira ja era desenhada com paleta escura fixa
// (bg quase preto, cards cinza-escuro, texto branco/amber) - por isso o
// "modo claro" e o estado novo (classes sem prefixo) e a paleta escura
// original vira variante `dark:` (aplicada via classe "dark" no <html>,
// controlada pelo componente ThemeToggle). Um script inline abaixo evita
// flash de tema errado no carregamento.

function toNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

const IMPRESSORAS = [
  { nome: "Ender 3 / S1", watts: 125 },
  { nome: "Ender 3 V3", watts: 100 },
  { nome: "K1 / K1C", watts: 120 },
  { nome: "K1 Max", watts: 200 },
  { nome: "Bambu A1", watts: 95 },
  { nome: "Bambu A1 Mini", watts: 45 },
  { nome: "Bambu P1S", watts: 100 },
  { nome: "Bambu X1C", watts: 120 },
  { nome: "Centauri Carbon", watts: 80 },
];

// Resolve o preco de anuncio pra bater uma margem liquida alvo (% sobre
// o preco), dado o custo total de producao e as regras de taxa de uma
// plataforma. Busca binaria em vez de algebra direta porque a Shopee
// tem faixas de comissao/taxa fixa que mudam de acordo com o proprio
// preco (nao da pra isolar P numa formula fechada unica).
function resolverPreco(opts: {
  custoTotal: number;
  impostoPct: number;
  adsPct: number;
  afiliadoPct?: number;
  margemAlvoPct: number;
  comissaoPct: (preco: number) => number;
  taxaFixa: (preco: number) => number;
}): number {
  const { custoTotal, impostoPct, adsPct, afiliadoPct = 0, margemAlvoPct, comissaoPct, taxaFixa } = opts;
  let lo = 0.01;
  let hi = 200000;
  for (let i = 0; i < 60; i++) {
    const preco = (lo + hi) / 2;
    const comissao = preco * (comissaoPct(preco) / 100);
    const fixa = taxaFixa(preco);
    const imposto = preco * (impostoPct / 100);
    const ads = preco * (adsPct / 100);
    const afiliado = preco * (afiliadoPct / 100);
    const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoTotal;
    const margem = preco > 0 ? (lucro / preco) * 100 : -999;
    if (margem < margemAlvoPct) lo = preco;
    else hi = preco;
  }
  return hi;
}

function IconBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-[#2a1a0a] text-xl font-bold text-amber-600 dark:text-amber-400">
      {children}
    </div>
  );
}

function Card({
  icon,
  title,
  subtitle,
  children,
titleClassName,
titleStyle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
titleClassName?: string;
titleStyle?: React.CSSProperties;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-[#23232b] bg-white dark:bg-[#131318] p-5">
      <div className="mb-4 flex items-start gap-3">
                <div>
          <h3 className={titleClassName || "text-base font-semibold text-gray-900 dark:text-white"} style={titleStyle}>{title}</h3>
          {subtitle && <p className="mt-0.5 text-base text-gray-500 dark:text-[#8b8b96]">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  placeholder = "0",
highlight = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
highlight?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={highlight ? "text-base font-semibold text-amber-600 dark:text-amber-400" : "text-base text-gray-500 dark:text-[#8b8b96]"}>{label}</span>
      <div className={highlight ? "flex items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-50 dark:bg-[#1c1206] ring-1 ring-amber-500/30 px-3 py-2" : "flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-[#2c2c36] bg-gray-50 dark:bg-[#0e0e12] px-3 py-2"}>
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={highlight ? "w-full bg-transparent text-xl font-bold text-amber-700 dark:text-amber-300 outline-none placeholder:text-gray-400 dark:placeholder:text-[#5c5c66] sm:text-lg" : "w-full bg-transparent text-lg text-gray-900 dark:text-white outline-none placeholder:text-gray-400 dark:placeholder:text-[#5c5c66] sm:text-base"}
        />
        {suffix && <span className={highlight ? "text-sm font-semibold text-amber-600 dark:text-amber-400" : "text-sm text-gray-400 dark:text-[#5c5c66]"}>{suffix}</span>}
      </div>
    </label>
  );
}

function LinhaTaxa({ label, valor, destaque = false }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={destaque ? "text-gray-700 dark:text-[#c8c8d0]" : "text-gray-500 dark:text-[#8b8b96]"}>{label}</span>
      <span className={destaque ? "font-semibold text-gray-900 dark:text-white" : "text-gray-900 dark:text-white"}>{valor}</span>
    </div>
  );
}

export default function PainelPage({ plataformaInicial }: { plataformaInicial?: "ml" | "shopee" } = {}) {
const router = useRouter();
useEffect(() => {
if (document.getElementById("fonts-marketplace")) return;
const link = document.createElement("link");
link.id = "fonts-marketplace";
link.rel = "stylesheet";
link.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&family=Roboto:wght@700;900&display=swap";
document.head.appendChild(link);
}, []);

// Quando a pagina e acessada via rota dedicada (/mercadolivrecalculadora
// ou /shopeecalculadora), pula o modal de escolha e ja mostra a
// calculadora da plataforma certa, rolando ate ela - pedido do Guilherme
// em 2026-08-27: escolher a plataforma no modal deve levar pra uma URL
// propria de cada uma, em vez de so trocar o conteudo em /painel.
useEffect(() => {
if (plataformaInicial) {
setTimeout(() => document.getElementById("calculadora")?.scrollIntoView({ behavior: "smooth" }), 50);
}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

  const [aba, setAba] = useState<"custos" | "precificacao">("precificacao");
  const [mostrarFerramenta, setMostrarFerramenta] = useState(!!plataformaInicial);

  // Impressora / energia
  const [impressora, setImpressora] = useState("Bambu A1");
  const [wattsCustom, setWattsCustom] = useState("");
  const [naoContabilizarEnergia, setNaoContabilizarEnergia] = useState(false);
  const [tarifaKwh, setTarifaKwh] = useState("0,90");

  // Manutencao (pedido explicito do Guilherme)
  const [manutencaoHora, setManutencaoHora] = useState("0,50");

  // Filamento
  const [pesoUsado, setPesoUsado] = useState("");
  const [custoKg, setCustoKg] = useState("");

  // Tempo
  const [horas, setHoras] = useState("");
  const [minutos, setMinutos] = useState("");
  const [quantidadePecas, setQuantidadePecas] = useState("1");
  const [impressoraAberta, setImpressoraAberta] = useState(false);
  const [impressoraConfirmada, setImpressoraConfirmada] = useState(false);
  const [maoDeObraAtiva, setMaoDeObraAtiva] = useState(false);

  // Falha de impressao (pedido explicito do Guilherme)
  const [falhaPct, setFalhaPct] = useState("5");

  // Custos adicionais
  const [embalagem, setEmbalagem] = useState("");
  const [maoDeObra, setMaoDeObra] = useState("");
  const [frete, setFrete] = useState("");
  const [desperdicioPct, setDesperdicioPct] = useState("");

  // Imposto (usado na aba Precificacao)
  const [impostoPct, setImpostoPct] = useState("6");

  // Precificacao
  const [modoPrecificacao, setModoPrecificacao] = useState<"margem" | "preco">("margem");
  const [margemDesejadaPct, setMargemDesejadaPct] = useState("30");
  const [precoVendaDesejado, setPrecoVendaDesejado] = useState("");
  const [custoProdutoManual, setCustoProdutoManual] = useState("");
  const [embalagemPrecificacao, setEmbalagemPrecificacao] = useState("");
  const [pesoProdutoKg, setPesoProdutoKg] = useState("");
  const [comissaoMLPct, setComissaoMLPct] = useState(String(COMISSAO_ML_CLASSICO_PCT).replace(".", ","));
  const [adsMLPct, setAdsMLPct] = useState("5");
  const [adsShopeePct, setAdsShopeePct] = useState("10");
  const [afiliadoShopeePct, setAfiliadoShopeePct] = useState("0");
  const [usaAfiliadoShopee, setUsaAfiliadoShopee] = useState(false);
  const [usaFlexShopee, setUsaFlexShopee] = useState(false);
  // Escolha de plataforma (Mercado Livre ou Shopee) - pedido do Guilherme em
  // 2026-08-27: em vez de mostrar as duas plataformas lado a lado, abre uma
  // janela perguntando qual plataforma o usuario quer, e so mostra aquela,
  // em largura cheia, com todas as comparacoes sempre visiveis.
  const [plataformaEscolhida, setPlataformaEscolhida] = useState<"ml" | "shopee" | null>(plataformaInicial ?? null);
  const [modalPlataformaAberto, setModalPlataformaAberto] = useState(false);
  const [custoFlexShopee, setCustoFlexShopee] = useState("");
  const [reembolsoFlexShopee, setReembolsoFlexShopee] = useState("");
  const [afiliadoMLPct, setAfiliadoMLPct] = useState("0");
  const [usaAfiliadoML, setUsaAfiliadoML] = useState(false);
  const [tipoAnuncioML, setTipoAnuncioML] = useState<"classico" | "premium">("classico");
  const [categoriaML, setCategoriaML] = useState("Casa, Moveis e Decoracao");
  const [freteGratisML, setFreteGratisML] = useState(true);
  const [usaFlexML, setUsaFlexML] = useState(false);
  const [custoFlexML, setCustoFlexML] = useState("");
  const [reembolsoFlexML, setReembolsoFlexML] = useState("");
  const [comprimentoCm, setComprimentoCm] = useState("");
  const [larguraCm, setLarguraCm] = useState("");
  const [alturaCm, setAlturaCm] = useState("");

  const wattsAtivos =
    impressora === "outra"
      ? toNum(wattsCustom)
      : IMPRESSORAS.find((i) => i.nome === impressora)?.watts ?? 0;

  const horasTotais = toNum(horas) + toNum(minutos) / 60;
  const custoEnergiaBruto = naoContabilizarEnergia ? 0 : (wattsAtivos / 1000) * horasTotais * toNum(tarifaKwh);
  const custoPorGrama = toNum(custoKg) / 1000;
  const custoMaterialBruto = toNum(pesoUsado) * custoPorGrama;
  const custoManutencaoBruto = horasTotais * toNum(manutencaoHora);

  const falhaFrac = Math.min(0.95, Math.max(0, toNum(falhaPct) / 100));
  const fatorFalha = falhaFrac > 0 ? 1 / (1 - falhaFrac) : 1;

  const custoEnergia = custoEnergiaBruto * fatorFalha;
  const fatorDesperdicio = 1 + Math.max(0, toNum(desperdicioPct) / 100);
  const custoMaterial = custoMaterialBruto * fatorFalha * fatorDesperdicio;
  const custoManutencao = custoManutencaoBruto * fatorFalha;
  const custoEmbalagem = toNum(embalagem);
  const custoMaoDeObra = maoDeObraAtiva ? toNum(maoDeObra) : 0;
  const custoFrete = toNum(frete);

  const custoTotal =
    custoEnergia + custoMaterial + custoManutencao + custoEmbalagem + custoMaoDeObra + custoFrete;
  const qtdPecas = Math.max(1, toNum(quantidadePecas) || 1);
  const custoPorPeca = custoTotal / qtdPecas;
  const custoBaseProduto = toNum(custoProdutoManual) || custoTotal;
  const custoParaPrecificacao = custoBaseProduto + toNum(embalagemPrecificacao);

  const margemAlvo = toNum(margemDesejadaPct);
  const pesoRealKg = toNum(pesoProdutoKg) || toNum(pesoUsado) / 1000;
  const pesoCubadoKg = (toNum(comprimentoCm) * toNum(larguraCm) * toNum(alturaCm)) / 6000;
  const pesoKgParaML = Math.max(pesoRealKg, pesoCubadoKg || 0);
  const flexLiquidoML = Math.max(0, toNum(custoFlexML) - toNum(reembolsoFlexML));
  const flexLiquidoShopee = Math.max(0, toNum(custoFlexShopee) - toNum(reembolsoFlexShopee));

  const resultadoML = useMemo(() => {
    function calcular(comFlex: boolean, comAfiliado: boolean, comAds: boolean = true, comFreteGratis?: boolean) {
      const afiliadoPctAtivo = comAfiliado ? toNum(afiliadoMLPct) : 0;
      const adsPctAtivo = comAds ? toNum(adsMLPct) : 0;
      const freteGratisAtivo = comFreteGratis === undefined ? freteGratisML : comFreteGratis;
      const taxaFixaFn = (preco: number) =>
        (freteGratisAtivo ? taxaPesoML(pesoKgParaML, preco) : taxaFixaMLSemFreteGratis(preco)) +
        (comFlex ? flexLiquidoML : 0);
      const preco =
        modoPrecificacao === "preco"
          ? toNum(precoVendaDesejado)
          : resolverPreco({
              custoTotal: custoParaPrecificacao,
              impostoPct: toNum(impostoPct),
              adsPct: adsPctAtivo,
              afiliadoPct: afiliadoPctAtivo,
              margemAlvoPct: margemAlvo,
              comissaoPct: () => toNum(comissaoMLPct),
              taxaFixa: taxaFixaFn,
            });
      const comissao = preco * (toNum(comissaoMLPct) / 100);
      const fixa = taxaFixaFn(preco);
      const imposto = preco * (toNum(impostoPct) / 100);
      const ads = preco * (adsPctAtivo / 100);
      const afiliado = preco * (afiliadoPctAtivo / 100);
      const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoParaPrecificacao;
      return { preco, comissao, fixa, imposto, ads, afiliado, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
    }

    const ativo = calcular(usaFlexML, usaAfiliadoML, true);
    const semFlex = calcular(false, usaAfiliadoML, true);
    const comFlex = calcular(true, usaAfiliadoML, true);
    const semAfiliado = calcular(usaFlexML, false, true);
    const comAfiliado = calcular(usaFlexML, true, true);
    const semAds = calcular(usaFlexML, usaAfiliadoML, false);
    const comAds = calcular(usaFlexML, usaAfiliadoML, true);
    const semFreteGratis = calcular(usaFlexML, usaAfiliadoML, true, false);
    const comFreteGratis = calcular(usaFlexML, usaAfiliadoML, true, true);
    return { ...ativo, semFlex, comFlex, semAfiliado, comAfiliado, semAds, comAds, semFreteGratis, comFreteGratis };
  }, [
    custoParaPrecificacao,
    impostoPct,
    adsMLPct,
    margemAlvo,
    comissaoMLPct,
    pesoKgParaML,
    freteGratisML,
    usaFlexML,
    flexLiquidoML,
    usaAfiliadoML,
    afiliadoMLPct,
    modoPrecificacao,
    precoVendaDesejado,
  ]);

  const resultadoShopee = useMemo(() => {
    function calcular(comFlex: boolean, comAfiliado: boolean, comAds: boolean = true) {
      const afiliadoPctAtivo = comAfiliado ? toNum(afiliadoShopeePct) : 0;
      const adsPctAtivo = comAds ? toNum(adsShopeePct) : 0;
      const taxaFixaFn = (preco: number) => taxaFixaShopee(preco) + (comFlex ? flexLiquidoShopee : 0);
      const preco =
        modoPrecificacao === "preco"
          ? toNum(precoVendaDesejado)
          : resolverPreco({
              custoTotal: custoParaPrecificacao,
              impostoPct: toNum(impostoPct),
              adsPct: adsPctAtivo,
              afiliadoPct: afiliadoPctAtivo,
              margemAlvoPct: margemAlvo,
              comissaoPct: (p) => comissaoShopeePct(p),
              taxaFixa: taxaFixaFn,
            });
      const comissao = preco * (comissaoShopeePct(preco) / 100);
      const fixa = taxaFixaFn(preco);
      const imposto = preco * (toNum(impostoPct) / 100);
      const ads = preco * (adsPctAtivo / 100);
      const afiliado = preco * (afiliadoPctAtivo / 100);
      const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoParaPrecificacao;
      return { preco, comissao, fixa, imposto, ads, afiliado, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
    }

    const ativo = calcular(usaFlexShopee, usaAfiliadoShopee, true);
    const semFlex = calcular(false, usaAfiliadoShopee, true);
    const comFlex = calcular(true, usaAfiliadoShopee, true);
    const semAfiliado = calcular(usaFlexShopee, false, true);
    const comAfiliado = calcular(usaFlexShopee, true, true);
    const semAds = calcular(usaFlexShopee, usaAfiliadoShopee, false);
    const comAds = calcular(usaFlexShopee, usaAfiliadoShopee, true);
    return { ...ativo, semFlex, comFlex, semAfiliado, comAfiliado, semAds, comAds };
  }, [
    custoParaPrecificacao,
    impostoPct,
    adsShopeePct,
    afiliadoShopeePct,
    margemAlvo,
    usaAfiliadoShopee,
    modoPrecificacao,
    precoVendaDesejado,
    usaFlexShopee,
    flexLiquidoShopee,
  ]);

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#0a0a0d] px-4 py-6 sm:px-8">
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              try {
                var stored = localStorage.getItem("theme");
                var isDark = stored ? stored === "dark" : true;
                if (isDark) {
                  document.documentElement.classList.add("dark");
                } else {
                  document.documentElement.classList.remove("dark");
                }
              } catch (e) {}
            })();
          `,
        }}
      />
      <a
        href="/login"
        className="absolute right-4 top-6 z-20 rounded-lg border border-gray-300 dark:border-[#2c2c36] bg-white dark:bg-[#131318] px-5 py-2.5 text-sm font-semibold text-gray-700 dark:text-[#c8c8d0] transition-colors hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400 sm:right-8"
      >
        Entrar
      </a>
      <header className="mb-6 flex items-center justify-center">
        <img src="/logo-7x7.png" alt="7x7 Escala Ecommerce" className="h-16 w-auto sm:h-28 invert hue-rotate-180 dark:invert-0 dark:hue-rotate-0" />
      </header>

      {modalPlataformaAberto && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setModalPlataformaAberto(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-[#23232b] bg-white dark:bg-[#131318] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Qual plataforma voce quer precificar?</h3>
            <p className="mt-1 text-base text-gray-500 dark:text-[#8b8b96]">
              Escolha Mercado Livre ou Shopee pra ver o preco, a margem e todas as comparacoes (com/sem ads, com/sem afiliado, com/sem frete gratis).
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setModalPlataformaAberto(false);
                  router.push("/mercadolivrecalculadora");
                }}
                className="flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-gray-200 dark:border-[#23232b] px-5 py-9 text-center transition hover:border-[#FFE600] hover:shadow-md"
              >
                <span
                  className="text-2xl font-extrabold leading-tight text-gray-900 dark:text-white"
                  style={{ fontFamily: "'Montserrat', sans-serif" }}
                >
                  Mercado Livre
                </span>
                <span className="h-1 w-12 rounded-full bg-[#FFE600]" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalPlataformaAberto(false);
                  router.push("/shopeecalculadora");
                }}
                className="flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-gray-200 dark:border-[#23232b] px-5 py-9 text-center transition hover:border-[#EE4D2D] hover:shadow-md"
              >
                <span
                  className="text-2xl font-black leading-tight text-gray-900 dark:text-white"
                  style={{ fontFamily: "'Roboto', sans-serif" }}
                >
                  Shopee
                </span>
                <span className="h-1 w-12 rounded-full bg-[#EE4D2D]" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setModalPlataformaAberto(false)}
              className="mt-4 text-sm text-gray-400 dark:text-[#5c5c66] hover:text-gray-600 dark:hover:text-[#8b8b96]"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 flex items-center gap-2">
        <button
          onClick={() => {
            setAba("precificacao");
            if (plataformaEscolhida) {
              setMostrarFerramenta(true);
              setTimeout(() => document.getElementById("calculadora")?.scrollIntoView({ behavior: "smooth" }), 50);
            } else {
              setModalPlataformaAberto(true);
            }
                    }}
          className={
            "rounded-lg px-5 py-2.5 text-base font-medium " +
            (aba === "precificacao" ? "bg-amber-500 text-black" : "bg-white dark:bg-[#131318] text-gray-500 dark:text-[#8b8b96] border border-gray-200 dark:border-[#23232b]")
          }
        >
          Precificação Marketplace
        </button>
        <button
          onClick={() => {
            setAba("custos");
setMostrarFerramenta(true);
setTimeout(() => document.getElementById("calculadora")?.scrollIntoView({ behavior: "smooth" }), 50);
                    }}
          className={
            "rounded-lg px-5 py-2.5 text-base font-medium " +
            (aba === "custos" ? "bg-amber-500 text-black" : "bg-white dark:bg-[#131318] text-gray-500 dark:text-[#8b8b96] border border-gray-200 dark:border-[#23232b]")
          }
        >
          Custo Produto 3D
        </button>
        <ThemeToggle />
      </div>

      <section className="relative mb-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-[#1f1f26] bg-white dark:bg-[#0d0d11] px-6 py-14 text-center sm:px-10">
        {/* Mockups ML/Shopee no fundo do hero — pedido do Guilherme em
            2026-08-26: no mobile os dois blocos borrados de 420x280px
            ficavam sem nenhuma variante responsiva, entao no celular eles
            colidiam bem no meio da tela, atras do titulo, em vez de ficar
            elegantes nas laterais como no desktop. Agora no mobile eles
            encolhem pra um tamanho de "selo" no canto superior (com menos
            blur, pra dar pra reconhecer que sao ML/Shopee) e voltam pro
            tamanho/posicao originais a partir do breakpoint sm. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-4 -top-4 h-24 w-36 -rotate-6 overflow-hidden rounded-xl border border-orange-500/30 opacity-70 blur-[1px] [animation:heroFadeA_9s_ease-in-out_infinite] sm:-left-10 sm:top-1/2 sm:h-[280px] sm:w-[420px] sm:-translate-y-1/2 sm:rounded-2xl sm:opacity-100 sm:blur-sm"
        >
          <img
            src="https://play-lh.googleusercontent.com/jcwNHNLapN3E_ztR3i6aptU0KU025nAKSzRZ1wteL8NDJnGjcqcbzImydkn73b9aq-hJpbiAjFJMO0JT7oox9w=w1080"
            alt=""
            className="h-full w-full object-cover"
          />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-4 h-24 w-36 rotate-6 overflow-hidden rounded-xl border border-yellow-400/30 opacity-70 blur-[1px] [animation:heroFadeB_9s_ease-in-out_infinite] sm:-right-10 sm:top-1/2 sm:h-[280px] sm:w-[420px] sm:-translate-y-1/2 sm:rounded-2xl sm:opacity-100 sm:blur-sm"
        >
          <img
            src="https://play-lh.googleusercontent.com/JFCnnrFW5VO0sTnoBcDfiQnINwI1PH9eaxMq7KidJpjsup6-fQbSDhYfsikZzufkv6sUD42OZWlkbpQaMRnP=w1080"
            alt=""
            className="h-full w-full object-cover"
          />
        </div>

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/35 dark:from-[#0d0d11]/35 via-transparent to-white/50 dark:to-[#0d0d11]/50" />

        <div className="relative z-10">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600 dark:text-amber-500">
            O que é o Escala 7x7 Ecommerce
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight text-gray-900 dark:text-white sm:text-5xl">
            Uma <span className="text-amber-600 dark:text-amber-500">plataforma de soluções</span> pro seu{" "}
            <span className="text-amber-600 dark:text-amber-500">ecommerce</span> ou{" "}
            <span className="text-amber-600 dark:text-amber-500">produção 3D</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-gray-500 dark:text-[#8b8b96] sm:text-lg">
            Gestão, produção, estoque, precificação e financeiro em um só lugar, pensado
            pra quem vende em marketplace ou produz sob demanda e quer crescer com margem,
            caixa e previsibilidade.
          </p>
        </div>
      </section>

      <section className="relative mb-6 overflow-hidden rounded-2xl bg-gradient-to-r from-amber-600 via-amber-500 to-orange-500 px-6 py-10 text-center sm:px-10">
        <style>{`
          @keyframes ctaFloatPrice {
            0%, 100% { transform: translateY(0px); opacity: 0.16; }
            50% { transform: translateY(-16px); opacity: 0.38; }
          }
          @keyframes ctaBarPulse {
            0%, 100% { transform: scaleY(0.55); }
            50% { transform: scaleY(1.15); }
          }
        `}</style>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className="absolute left-[4%] top-[10%] font-mono text-3xl font-bold text-black/20 sm:text-4xl" style={{ animation: "ctaFloatPrice 5s ease-in-out infinite" }}>R$ 49,90</span>
          <span className="absolute left-[20%] top-[64%] font-mono text-xl font-bold text-black/15 sm:text-2xl" style={{ animation: "ctaFloatPrice 6.5s ease-in-out infinite", animationDelay: "0.8s" }}>-12%</span>
          <span className="absolute left-[46%] top-[6%] font-mono text-2xl font-bold text-black/15 sm:text-3xl" style={{ animation: "ctaFloatPrice 7s ease-in-out infinite", animationDelay: "1.6s" }}>R$ 129,90</span>
          <span className="absolute right-[6%] top-[18%] font-mono text-3xl font-bold text-black/20 sm:text-4xl" style={{ animation: "ctaFloatPrice 5.5s ease-in-out infinite", animationDelay: "0.4s" }}>+8%</span>
          <span className="absolute right-[16%] top-[68%] font-mono text-xl font-bold text-black/15 sm:text-2xl" style={{ animation: "ctaFloatPrice 6s ease-in-out infinite", animationDelay: "1.2s" }}>R$ 0,00</span>
          <span className="absolute left-[10%] bottom-[8%] font-mono text-xl font-bold text-black/15 sm:text-2xl" style={{ animation: "ctaFloatPrice 7.5s ease-in-out infinite", animationDelay: "2s" }}>34,99</span>
          <span className="absolute right-[34%] bottom-[6%] font-mono text-2xl font-bold text-black/20 sm:text-3xl" style={{ animation: "ctaFloatPrice 6.2s ease-in-out infinite", animationDelay: "0.6s" }}>+15%</span>
          <div className="absolute inset-x-3 inset-y-0 flex items-end gap-1 sm:inset-x-6 sm:gap-1.5">
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "40%", transformOrigin: "bottom", animation: "ctaBarPulse 2.2s ease-in-out infinite" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "70%", transformOrigin: "bottom", animation: "ctaBarPulse 2.6s ease-in-out infinite", animationDelay: "0.3s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "55%", transformOrigin: "bottom", animation: "ctaBarPulse 2.4s ease-in-out infinite", animationDelay: "0.6s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "85%", transformOrigin: "bottom", animation: "ctaBarPulse 2.8s ease-in-out infinite", animationDelay: "0.15s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "65%", transformOrigin: "bottom", animation: "ctaBarPulse 2.3s ease-in-out infinite", animationDelay: "0.45s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "60%", transformOrigin: "bottom", animation: "ctaBarPulse 2.5s ease-in-out infinite", animationDelay: "0.2s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "35%", transformOrigin: "bottom", animation: "ctaBarPulse 2.1s ease-in-out infinite", animationDelay: "0.5s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "80%", transformOrigin: "bottom", animation: "ctaBarPulse 2.7s ease-in-out infinite", animationDelay: "0.1s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "50%", transformOrigin: "bottom", animation: "ctaBarPulse 2.4s ease-in-out infinite", animationDelay: "0.7s" }} />
            <div className="flex-1 rounded-t bg-white/25" style={{ height: "90%", transformOrigin: "bottom", animation: "ctaBarPulse 2.9s ease-in-out infinite", animationDelay: "0.35s" }} />
          </div>
        </div>
        <div className="relative z-10">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-black/70">
          Precificação
        </p>
        <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold leading-tight text-black sm:text-4xl">
          Sua precificação nas plataformas está correta?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-black/80 sm:text-lg">
          Confira agora nossa calculadora pra <span className="font-bold">Mercado Livre e Shopee</span>.{" "}
          <span className="whitespace-nowrap">O custo disso: <span className="text-xl font-bold sm:text-2xl">R$ 0,00</span>.</span>
        </p>
        <button
          onClick={() => {
            setAba("precificacao");
            if (plataformaEscolhida) {
              setMostrarFerramenta(true);
              setTimeout(() => document.getElementById("calculadora")?.scrollIntoView({ behavior: "smooth" }), 50);
            } else {
              setModalPlataformaAberto(true);
            }
          }}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-black px-6 py-3 text-base font-semibold text-white transition hover:bg-black/80"
        >
          Calcular minha precificação
          <span aria-hidden>{"→"}</span>
        </button>
        </div>
      </section>

      <section className="relative mb-6 overflow-hidden rounded-2xl border border-gray-200 dark:border-[#1f1f26] bg-white dark:bg-[#0d0d11] py-6 text-center sm:px-10 sm:py-12">
        <style>{`
          @keyframes marqueeScrollLeft {
            from { transform: translateX(0); }
            to { transform: translateX(-50%); }
          }
        `}</style>

        {/* Mobile: faixa de fotos separada, em fluxo normal, acima do texto
            — pedido do Guilherme em 2026-08-26: as fotos nao estavam
            dando pra ver direito no celular, so aparecia uma tira cortada
            sobrepondo o texto. Isso acontecia porque o efeito de colagem
            de fundo (fotos atras, card de texto flutuando por cima) so
            funciona quando sobra espaco nas laterais do card — no mobile
            o card ocupa quase a largura toda da tela, entao so escapava
            uma tira fina da foto por cima do texto. Agora no mobile a
            faixa de fotos e uma secao propria, sem sobrepor nada, e o
            texto fica embaixo em fundo solido, sempre legivel. */}
        <div className="overflow-hidden border-b border-gray-200 dark:border-[#1f1f26] py-4 sm:hidden">
          <div className="flex w-max items-center gap-3" style={{ animation: "marqueeScrollLeft 40s linear infinite" }}>
            {["/carrossel-1.jpg","/carrossel-2.jpg","/carrossel-3.jpg","/carrossel-4.jpg","/carrossel-5.jpg","/carrossel-6.jpg","/carrossel-7.jpg","/carrossel-8.jpg","/carrossel-9.jpg","/carrossel-10.jpg","/carrossel-11.jpg","/carrossel-12.jpg","/carrossel-13.jpg","/carrossel-14.jpg","/carrossel-15.jpg","/carrossel-16.jpg","/carrossel-1.jpg","/carrossel-2.jpg","/carrossel-3.jpg","/carrossel-4.jpg","/carrossel-5.jpg","/carrossel-6.jpg","/carrossel-7.jpg","/carrossel-8.jpg","/carrossel-9.jpg","/carrossel-10.jpg","/carrossel-11.jpg","/carrossel-12.jpg","/carrossel-13.jpg","/carrossel-14.jpg","/carrossel-15.jpg","/carrossel-16.jpg"].map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`m-${i}`}
                src={src}
                alt="Trajetória Escala 7x7 Ecommerce"
                className="h-20 w-28 flex-shrink-0 rounded-lg bg-gray-100 dark:bg-[#15151d] object-contain opacity-90"
              />
            ))}
          </div>
        </div>

        {/* Desktop/tablet: colagem de fundo original (fotos atras, card de
            texto translucido flutuando por cima) — inalterada, so
            escondida no mobile porque e la que ela nao funcionava bem. */}
        <div className="pointer-events-none absolute inset-0 hidden items-center overflow-hidden sm:flex">
          <div className="flex shrink-0 items-center gap-4" style={{ animation: "marqueeScrollLeft 96s linear infinite" }}>
            {["/carrossel-1.jpg","/carrossel-2.jpg","/carrossel-3.jpg","/carrossel-4.jpg","/carrossel-5.jpg","/carrossel-6.jpg","/carrossel-7.jpg","/carrossel-8.jpg","/carrossel-9.jpg","/carrossel-10.jpg","/carrossel-11.jpg","/carrossel-12.jpg","/carrossel-13.jpg","/carrossel-14.jpg","/carrossel-15.jpg","/carrossel-16.jpg","/carrossel-1.jpg","/carrossel-2.jpg","/carrossel-3.jpg","/carrossel-4.jpg","/carrossel-5.jpg","/carrossel-6.jpg","/carrossel-7.jpg","/carrossel-8.jpg","/carrossel-9.jpg","/carrossel-10.jpg","/carrossel-11.jpg","/carrossel-12.jpg","/carrossel-13.jpg","/carrossel-14.jpg","/carrossel-15.jpg","/carrossel-16.jpg"].map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt="Trajetória Escala 7x7 Ecommerce"
                className="h-48 w-72 flex-shrink-0 rounded-xl bg-gray-100 dark:bg-[#15151d] object-contain opacity-90"
              />
            ))}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 hidden bg-white/20 dark:bg-[#0d0d11]/20 sm:block" />

        <div className="relative z-10 mx-auto max-w-2xl px-5 py-7 sm:rounded-2xl sm:bg-white/75 dark:sm:bg-[#0d0d11]/75 sm:px-10 sm:py-9 sm:backdrop-blur-md">
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white sm:text-4xl">
            <span className="text-amber-600 dark:text-amber-500">11 anos</span> no Mercado de{" "}
            <span className="text-amber-600 dark:text-amber-500">Marketplace</span>.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-gray-500 dark:text-[#8b8b96] sm:text-lg">
            <span className="block font-bold text-gray-900 dark:text-white sm:whitespace-nowrap">
              Tempo suficiente pra testar o que funciona e descartar o que só parece funcionar.
            </span>
            <span className="mt-1 block">
              Gestão de conta, execução de campanha, precificação e produção
              validado na prática, todo dia.
            </span>
          </p>

          <div className="mx-auto mt-8 flex max-w-xl items-center gap-4">
            <span className="text-sm font-semibold text-gray-500 dark:text-[#8b8b96]">2019</span>
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-[#2a2a33]">
              <div className="absolute inset-y-0 left-0 w-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
            </div>
            <span className="text-sm font-semibold text-amber-600 dark:text-amber-500">2026</span>
          </div>

          <p className="mt-6 text-base font-semibold text-gray-900 dark:text-white sm:text-lg">
            É nisso que o Escala 7x7 Ecommerce foi construído.
          </p>

          <div className="mt-5 flex items-center justify-center gap-4">
            <a
              href="https://www.instagram.com/_morogui/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 dark:border-[#2c2c36] bg-white dark:bg-[#131318] text-gray-700 dark:text-[#c8c8d0] transition-colors hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <rect x="3" y="3" width="18" height="18" rx="5" ry="5" />
                <path d="M16 11.37a4 4 0 1 1-7.914 1.174A4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
            </a>
            <a
              href="https://www.linkedin.com/in/guilherme-moro-484221168/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 dark:border-[#2c2c36] bg-white dark:bg-[#131318] text-gray-700 dark:text-[#c8c8d0] transition-colors hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.351V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.114 20.452H3.558V9h3.556v11.452z" />
              </svg>
            </a>
          </div>
        </div>
      </section>


      {mostrarFerramenta && (
      <div id="calculadora">


      {aba === "custos" && (
        <div className="flex flex-col gap-4">
          <div className={impressoraConfirmada ? "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" : "flex justify-center"}>
            <div className={impressoraConfirmada ? "" : "w-full max-w-sm"}>
              <Card icon="P1" title="Impressora" subtitle="Consumo medio durante a impressao">
                {!impressoraAberta && (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <button
                      type="button"
                      onClick={() => setImpressoraAberta(true)}
                      className="rounded-2xl border border-gray-200 dark:border-[#23232b] bg-white dark:bg-[#131318] px-8 py-6 text-base font-medium text-gray-900 dark:text-white transition hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
                    >
                      Escolha sua impressora
                    </button>
                  </div>
                )}
                {impressoraAberta && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {IMPRESSORAS.map((imp) => (
                        <button
                          key={imp.nome}
                          onClick={() => setImpressora(imp.nome)}
                          className={
                            "rounded-lg border px-3 py-2 text-left text-base " +
                            (impressora === imp.nome
                              ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400"
                              : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                          }
                        >
                          <div className="font-medium">{imp.nome}</div>
                          <div className="text-sm text-gray-500 dark:text-[#8b8b96]">~{imp.watts}W medio</div>
                        </button>
                    ))}
                      <button
                        onClick={() => setImpressora("outra")}
                        className={
                          "rounded-lg border px-3 py-2 text-left text-base " +
                          (impressora === "outra"
                            ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400"
                            : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        <div className="font-medium">Outra</div>
                        <div className="text-sm text-gray-500 dark:text-[#8b8b96]">Digitar watts</div>
                      </button>
                    </div>
                    {impressora === "outra" && (
                      <div className="mt-2">
                        <Field label="Potencia (W)" value={wattsCustom} onChange={setWattsCustom} suffix="W" />
                      </div>
                    )}
                    <label className="mt-3 flex items-center gap-2 text-base text-gray-500 dark:text-[#8b8b96]">
                      <input
                        type="checkbox"
                        checked={naoContabilizarEnergia}
                        onChange={(e) => setNaoContabilizarEnergia(e.target.checked)}
                      />
                      Nao contabilizar energia
                    </label>
                    {!impressoraConfirmada && (
                      <button
                        type="button"
                        onClick={() => setImpressoraConfirmada(true)}
                        className="mt-3 w-full rounded-xl bg-amber-500 px-5 py-2.5 text-base font-semibold text-black transition hover:bg-amber-400"
                      >
                        OK
                      </button>
                    )}
                  </>
                )}
              </Card>
            </div>

            {impressoraConfirmada && (
              <>
                <Card icon="P2" title="Consumo e Operacao" subtitle="Manutencao, energia, falha, embalagem e mao de obra">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Field label="Manutencao" value={manutencaoHora} onChange={setManutencaoHora} suffix="R$/h" />
                    <Field label="Energia" value={tarifaKwh} onChange={setTarifaKwh} suffix="R$/kWh" />
                    <Field label="Falha de impressao" value={falhaPct} onChange={setFalhaPct} suffix="%" />
                    <Field label="Embalagem" value={embalagem} onChange={setEmbalagem} suffix="R$" />
                  </div>
                  {maoDeObraAtiva ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label="Mao de obra" value={maoDeObra} onChange={setMaoDeObra} suffix="R$" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMaoDeObraAtiva(true)}
                      className="mt-2 flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400 transition hover:text-amber-500 dark:hover:text-amber-300"
                    >
                      + Mao de obra
                    </button>
                  )}
                  <p className="mt-2 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                    Manutencao cobre bicos, correias e depreciacao do equipamento. Falha de impressao encarece energia, material e maquina pra cobrir as reimpressoes. Media Brasil de energia ~R$0,90/kWh.
                </p>
                </Card>

                <Card icon="P3" title="Material e Tempo" subtitle="Filamento usado e duracao da impressao">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Peso usado" value={pesoUsado} onChange={setPesoUsado} suffix="g" />
                    <Field label="Custo do kg" value={custoKg} onChange={setCustoKg} suffix="R$" />
                    <Field label="Horas" value={horas} onChange={setHoras} suffix="h" />
                    <Field label="Minutos" value={minutos} onChange={setMinutos} suffix="min" />
                    <Field label="Quantidade de pecas" value={quantidadePecas} onChange={setQuantidadePecas} suffix="un" />
                  </div>
                  <p className="mt-2 text-base text-gray-500 dark:text-[#8b8b96]">
                    Custo por grama: <span className="text-gray-900 dark:text-white">{formatBRL(custoPorGrama)}</span>
                  </p>
                </Card>

                <Card icon="P4" title="Custos Extras" subtitle="Frete, imposto e desperdicio de material">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Frete" value={frete} onChange={setFrete} suffix="R$" />
                    <Field label="Imposto" value={impostoPct} onChange={setImpostoPct} suffix="%" />
                    <Field label="% de desperdicio" value={desperdicioPct} onChange={setDesperdicioPct} suffix="%" />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                    Frete e opcional. Imposto e usado na aba Precificacao - MEI ~5% do salario minimo (fixo), Simples Nacional varia. Desperdicio de material aumenta o custo do filamento usado. Deixe 0 se nao se aplica.
                  </p>
                </Card>
              </>
            )}
          </div>

          {impressoraConfirmada && (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-50 dark:bg-[#161108] p-5">
              <p className="text-base text-gray-500 dark:text-[#8b8b96]">Custo total de producao</p>
              <p className="mt-1 text-4xl font-bold text-amber-600 dark:text-amber-400">{formatBRL(custoTotal)}</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-[#8b8b96]">Custo por peca ({qtdPecas}un): <span className="text-gray-900 dark:text-white font-semibold">{formatBRL(custoPorPeca)}</span></p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Energia</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoEnergia)}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Material</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoMaterial)}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Manutencao</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoManutencao)}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Embalagem</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoEmbalagem)}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Mao de obra</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoMaoDeObra)}</p>
                </div>
                <div>
                  <p className="text-gray-400 dark:text-[#5c5c66]">Frete</p>
                  <p className="text-gray-900 dark:text-white">{formatBRL(custoFrete)}</p>
                </div>
              </div>
              {falhaFrac > 0 && (
                <p className="mt-3 text-sm text-gray-400 dark:text-[#5c5c66]">
                  Energia, material e manutencao ja incluem a taxa de falha de {fmtPct(toNum(falhaPct))} (fator x
                  {fatorFalha.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {aba === "precificacao" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-gray-200 dark:border-[#23232b] bg-white dark:bg-[#131318] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-[220px] flex-1">
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-black">
                    Obrigatorio
                  </span>
                  <span className="text-sm text-gray-400 dark:text-[#5c5c66]">Preencha primeiro</span>
                </div>
                <Field
                  label="Custo do produto"
                  value={custoProdutoManual}
                  onChange={setCustoProdutoManual}
                  suffix="R$"
                  placeholder={custoTotal > 0 ? custoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}
                highlight
/>
              </div>
              <div className="max-w-[220px] flex-1">
                <Field label="Embalagem (por peca)" value={embalagemPrecificacao} onChange={setEmbalagemPrecificacao} suffix="R$" />
              </div>
              <div className="text-right">
                <p className="text-base text-gray-500 dark:text-[#8b8b96]">Custo usado no calculo</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatBRL(custoParaPrecificacao)}</p>
              </div>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
              Digite aqui o custo real do seu produto (essa aba funciona sozinha, sem depender da aba Custo Produto 3D). Se preferir, use a aba Custo Produto 3D so como apoio pra chegar nesse numero. Embalagem entra separado e soma no custo total usado no calculo.
            </p>
          </div>

          <Card
            icon="P9"
            title="Margem e imposto"
            subtitle={
              modoPrecificacao === "margem"
                ? "Digite a margem de lucro que voce quer e o imposto que voce paga por venda"
                : "Digite o preco de venda que voce quer praticar e veja a margem liquida resultante em cada plataforma"
            }
          >
            <p className="mb-2 text-base font-semibold text-gray-700 dark:text-[#c8c8d0]">Escolha como quer precificar</p>
            <div className="mb-3 grid max-w-[320px] grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setModoPrecificacao("margem")}
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (modoPrecificacao === "margem" ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                }
              >
                Por margem
              </button>
              <button
                type="button"
                onClick={() => setModoPrecificacao("preco")}
                className={
                  "rounded-lg border px-3 py-2 text-sm font-medium " +
                  (modoPrecificacao === "preco" ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                }
              >
                Por preço de venda
              </button>
            </div>
            <div className="grid max-w-[320px] grid-cols-2 gap-2">
              {modoPrecificacao === "margem" ? (
                <Field label="Margem liquida desejada" value={margemDesejadaPct} onChange={setMargemDesejadaPct} suffix="%" />
              ) : (
                <Field label="Preço de venda desejado" value={precoVendaDesejado} onChange={setPrecoVendaDesejado} suffix="R$" />
              )}
              <Field label="Imposto (%)" value={impostoPct} onChange={setImpostoPct} suffix="%" />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
              {modoPrecificacao === "margem"
                ? "Imposto: MEI ~5% do salario minimo (fixo), Simples Nacional varia - confirme com sua contadora."
                : "O mesmo preco de venda e aplicado nas duas plataformas - a margem liquida final aparece calculada em cada card abaixo, porque as taxas de ML e Shopee sao diferentes."}
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4">
            {!plataformaEscolhida && (
              <div className="rounded-2xl border border-dashed border-gray-300 dark:border-[#2c2c36] bg-white dark:bg-[#131318] p-10 text-center">
                <p className="text-base text-gray-500 dark:text-[#8b8b96]">Escolha uma plataforma pra ver sua precificacao, com todas as comparacoes (ads, afiliado, frete gratis).</p>
                <button
                  type="button"
                  onClick={() => setModalPlataformaAberto(true)}
                  className="mt-4 rounded-lg bg-amber-500 px-5 py-2.5 text-base font-semibold text-black transition hover:bg-amber-400"
                >
                  Escolher plataforma
                </button>
              </div>
            )}

            {plataformaEscolhida === "ml" && (
            <div>
              <button
                type="button"
                onClick={() => setModalPlataformaAberto(true)}
                className="mb-3 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300"
              >
                {"←"} Trocar plataforma
              </button>
<Card icon="ML" title="Mercado Livre" titleClassName="text-3xl font-extrabold text-[#FFE600]" titleStyle={{ fontFamily: "'Montserrat', sans-serif" }} subtitle="Comissao + taxa fixa por peso + imposto + ads">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Categoria (Mercado Livre)</p>
                    <select
                      value={categoriaML}
                      onChange={(e) => {
                        const nome = e.target.value;
                        setCategoriaML(nome);
                        const cat = CATEGORIAS_ML.find((c) => c.nome === nome);
                        if (cat) {
                          const pct = tipoAnuncioML === "premium" ? cat.premiumPct : cat.classicoPct;
                          setComissaoMLPct(String(pct).replace(".", ","));
                        }
                      }}
                      className="w-full rounded-lg border border-gray-300 dark:border-[#2c2c36] bg-gray-50 dark:bg-[#0e0e12] px-3 py-2 text-base text-gray-900 dark:text-white outline-none"
                    >
                      {CATEGORIAS_ML.map((cat) => (
                        <option key={cat.nome} value={cat.nome}>{cat.nome}</option>
                      ))}
                      <option value="outra">Outra (digitar manualmente)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Tipo de anuncio</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTipoAnuncioML("classico");
                            const catC = CATEGORIAS_ML.find((c) => c.nome === categoriaML);
                            setComissaoMLPct(String(catC ? catC.classicoPct : COMISSAO_ML_CLASSICO_PCT).replace(".", ","));
                          }}
                          className={
                            "rounded-lg border px-3 py-2 text-sm font-medium " +
                            (tipoAnuncioML === "classico" ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                          }
                        >
                          Classico
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTipoAnuncioML("premium");
                            const catP = CATEGORIAS_ML.find((c) => c.nome === categoriaML);
                            setComissaoMLPct(String(catP ? catP.premiumPct : COMISSAO_ML_PREMIUM_PCT).replace(".", ","));   >
                          Premium
                        </button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Frete gratis pro comprador?</p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFreteGratisML(true)}
                          className={
                            "rounded-lg border px-3 py-2 text-sm font-medium " +
                            (freteGratisML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                          }
                        >
                          Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => setFreteGratisML(false)}
                          className={
                            "rounded-lg border px-3 py-2 text-sm font-medium " +
                            (!freteGratisML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                          }
                        >
                          Nao
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Comissao ML (%)" value={comissaoMLPct} onChange={setComissaoMLPct} suffix="%" />
                      <Field label="Ads ML (%)" value={adsMLPct} onChange={setAdsMLPct} suffix="%" />
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      Comissao: taxa que o Mercado Livre cobra sobre o preco de venda (Classico ~{COMISSAO_ML_CLASSICO_PCT}%, Premium ~{COMISSAO_ML_PREMIUM_PCT}% - clique acima ou ajuste o numero manualmente). Ads: seu investimento em Mercado Ads sobre a venda.
                    </p>
                  </div>

                  <div>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Peso do produto" value={pesoProdutoKg} onChange={setPesoProdutoKg} suffix="kg" placeholder={(toNum(pesoUsado) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} />
                      <Field label="Comprimento" value={comprimentoCm} onChange={setComprimentoCm} suffix="cm" />
                      <Field label="Largura" value={larguraCm} onChange={setLarguraCm} suffix="cm" />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field label="Altura" value={alturaCm} onChange={setAlturaCm} suffix="cm" />
                      <div className="flex flex-col justify-end text-base text-gray-500 dark:text-[#8b8b96]">
                        Taxa fixa cobrada: <span className="text-gray-900 dark:text-white">{formatBRL(resultadoML.fixa)}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      A taxa fixa do ML muda conforme voce oferece frete gratis ou nao, e tambem e por faixa de peso/preco (tabela oficial do ML, valida a partir de 24/08/2026). Se a caixa (C x L x A) resultar num peso cubado maior que o peso real do produto, o ML cobra pelo cubado - preencha as dimensoes pra ver a taxa correta.
                    </p>
                  </div>

                  <div className="border-t border-gray-200 dark:border-[#23232b] pt-3">
                    <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Voce envia por Mercado Envios Flex?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUsaFlexML(false)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (!usaFlexML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Nao uso Flex
                      </button>
                      <button
                        type="button"
                        onClick={() => setUsaFlexML(true)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (usaFlexML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Uso Flex
                      </button>
                    </div>
                    {usaFlexML && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Field label="Custo do Flex" value={custoFlexML} onChange={setCustoFlexML} suffix="R$" />
                        <Field label="Reembolso do Flex" value={reembolsoFlexML} onChange={setReembolsoFlexML} suffix="R$" />
                      </div>
                    )}
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      O Flex tem um custo de entrega que o ML repassa e reembolsa parte dele. Preencha os dois valores reais (confira no seu extrato) pra comparar quanto voce recebe liquido vendendo com Flex e sem Flex.
                    </p>
                  </div>

                  <div className="border-t border-gray-200 dark:border-[#23232b] pt-3">
                    <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Participa do programa de parceiros (afiliados)?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUsaAfiliadoML(false)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (!usaAfiliadoML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                    >
                        Nao uso afiliados
                      </button>
                      <button
                        type="button"
                        onClick={() => setUsaAfiliadoML(true)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (usaAfiliadoML ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Uso afiliados
                      </button>
                    </div>
                    {usaAfiliadoML && (
                      <div className="mt-2">
                        <Field label="Afiliado ML (%)" value={afiliadoMLPct} onChange={setAfiliadoMLPct} suffix="%" />
                      </div>
                    )}
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      Parceiros Mercado Livre: comissao paga a criadores/afiliados que divulgam seu produto - so entra na conta se voce marcar "Uso afiliados" acima.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
                  <div className="grid grid-cols-1 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3 sm:grid-cols-2">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Preco de venda</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.preco)}</p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Preco para anunciar (+30%)</p>
                      <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{formatBRL(resultadoML.preco * 1.3)}</p>
                    </div>
                    <p className="col-span-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66] sm:col-span-2">
                      Anuncie pelo preco maior pra abrir espaco pra promocao/cupom na central de promocoes sem furar sua margem. O preco de venda real (o que voce recebe liquido) e sempre o da esquerda.
                    </p>
                    <div className="col-span-1 mt-1 flex gap-4 text-base sm:col-span-2">
                      <span className="text-gray-500 dark:text-[#8b8b96]">
                        Margem liquida <span className="text-green-600 dark:text-green-400">{fmtPct(resultadoML.margemPct)}</span>
                      </span>
                      <span className="text-gray-500 dark:text-[#8b8b96]">
                        Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.lucro)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Sem Ads</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.semAds.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.semAds.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Com Ads</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.comAds.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.comAds.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Sem frete gratis</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.semFreteGratis.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.semFreteGratis.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Com frete gratis</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.comFreteGratis.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.comFreteGratis.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Vendendo sem Flex</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.semFlex.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.semFlex.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Vendendo com Flex</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.comFlex.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.comFlex.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Sem afiliados</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.semAfiliado.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.semAfiliado.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Com afiliados</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoML.comAfiliado.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoML.comAfiliado.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3 text-base">
                    <p className="mb-2 font-medium text-gray-700 dark:text-[#c8c8d0]">Detalhamento das taxas (sobre o preco de venda)</p>
                    <div className="flex flex-col gap-1">
                      <LinhaTaxa label={`Comissao (${comissaoMLPct}%)`} valor={formatBRL(resultadoML.comissao)} />
                      <LinhaTaxa label="Taxa fixa de envio" valor={formatBRL(resultadoML.fixa)} />
                      <LinhaTaxa label={`Imposto (${impostoPct}%)`} valor={formatBRL(resultadoML.imposto)} />
                      <LinhaTaxa label={`Ads (${adsMLPct}%)`} valor={formatBRL(resultadoML.ads)} />
                      {usaAfiliadoML && <LinhaTaxa label={`Afiliado (${afiliadoMLPct}%)`} valor={formatBRL(resultadoML.afiliado)} />}
                      <LinhaTaxa label="Custo do produto" valor={formatBRL(custoBaseProduto)} />
                      {toNum(embalagemPrecificacao) > 0 && <LinhaTaxa label="Embalagem" valor={formatBRL(toNum(embalagemPrecificacao))} />}
                      <div className="mt-1 border-t border-gray-200 dark:border-[#23232b] pt-1">
                        <LinhaTaxa label="Lucro liquido" valor={formatBRL(resultadoML.lucro)} destaque />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
</div>
            )}

            {plataformaEscolhida === "shopee" && (
            <div>
              <button
                type="button"
                onClick={() => setModalPlataformaAberto(true)}
                className="mb-3 text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300"
              >
                {"←"} Trocar plataforma
              </button>
<Card icon="SH" title="Shopee" titleClassName="text-3xl font-black text-[#EE4D2D]" titleStyle={{ fontFamily: "'Roboto', sans-serif" }} subtitle="Comissao + taxa fixa automatica + ads + afiliado">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Participa do programa de afiliados?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUsaAfiliadoShopee(false)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (!usaAfiliadoShopee ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Nao uso afiliados
                      </button>
                      <button
                        type="button"
                        onClick={() => setUsaAfiliadoShopee(true)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (usaAfiliadoShopee ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Uso afiliados
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label="Ads Shopee (%)" value={adsShopeePct} onChange={setAdsShopeePct} suffix="%" />
                      {usaAfiliadoShopee && (
                        <Field label="Afiliado (%)" value={afiliadoShopeePct} onChange={setAfiliadoShopeePct} suffix="%" />
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      Ads: seu investimento em Shopee Ads sobre a venda. Afiliado: comissao paga a criadores de conteudo/afiliados que divulgam seu produto - so entra na conta se voce marcar "Uso afiliados" acima.
                    </p>
                  </div>

                  <div className="border-t border-gray-200 dark:border-[#23232b] pt-3">
                    <p className="mb-1.5 text-base font-medium text-gray-700 dark:text-[#c8c8d0]">Voce envia por Shopee Entrega Direta / Envio Flex (entrega propria)?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setUsaFlexShopee(false)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (!usaFlexShopee ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Nao uso Flex
                      </button>
                      <button
                        type="button"
                        onClick={() => setUsaFlexShopee(true)}
                        className={
                          "rounded-lg border px-3 py-2 text-sm font-medium " +
                          (usaFlexShopee ? "border-amber-500 bg-amber-100 dark:bg-[#2a1a0a] text-amber-600 dark:text-amber-400" : "border-gray-300 dark:border-[#2c2c36] text-gray-700 dark:text-[#c8c8d0]")
                        }
                      >
                        Uso Flex
                      </button>
                    </div>
                    {usaFlexShopee && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Field label="Custo do Flex" value={custoFlexShopee} onChange={setCustoFlexShopee} suffix="R$" />
                        <Field label="Reembolso do Flex" value={reembolsoFlexShopee} onChange={setReembolsoFlexShopee} suffix="R$" />
                      </div>
                    )}
                    <p className="mt-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66]">
                      Na Shopee Entrega Direta (Envio Flex) voce mesmo faz a entrega (ou contrata um parceiro/motoboy), em vez de usar os Correios/transportadora da Shopee. Preencha o custo real dessa entrega e um eventual reembolso da Shopee (confira no seu extrato) pra comparar quanto voce recebe liquido vendendo com Flex e sem Flex.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:self-start">
                  <div className="grid grid-cols-1 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3 sm:grid-cols-2">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Preco de venda</p>
                      <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.preco)}</p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Preco para anunciar (+30%)</p>
                      <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">{formatBRL(resultadoShopee.preco * 1.3)}</p>
                    </div>
                    <p className="col-span-1 text-sm leading-relaxed text-gray-400 dark:text-[#5c5c66] sm:col-span-2">
                      Anuncie pelo preco maior pra abrir espaco pra promocao/cupom na central de promocoes sem furar sua margem. O preco de venda real (o que voce recebe liquido) e sempre o da esquerda.
                    </p>
                    <div className="col-span-1 mt-1 flex gap-4 text-base sm:col-span-2">
                      <span className="text-gray-500 dark:text-[#8b8b96]">
                        Margem liquida <span className="text-green-600 dark:text-green-400">{fmtPct(resultadoShopee.margemPct)}</span>
                      </span>
                      <span className="text-gray-500 dark:text-[#8b8b96]">
                        Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.lucro)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Sem Ads</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.semAds.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.semAds.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Com Ads</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.comAds.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.comAds.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Sem afiliados</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.semAfiliado.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.semAfiliado.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Com afiliados</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.comAfiliado.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.comAfiliado.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3">
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Vendendo sem Flex</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.semFlex.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.semFlex.lucro)}</span></p>
                    </div>
                    <div>
                      <p className="text-base text-gray-500 dark:text-[#8b8b96]">Vendendo com Flex</p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">{formatBRL(resultadoShopee.comFlex.preco)}</p>
                      <p className="text-sm text-gray-500 dark:text-[#8b8b96]">Lucro <span className="text-green-600 dark:text-green-400">{formatBRL(resultadoShopee.comFlex.lucro)}</span></p>
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 dark:bg-[#0e0e12] p-3 text-base">
                    <p className="mb-2 font-medium text-gray-700 dark:text-[#c8c8d0]">Detalhamento das taxas (sobre o preco de venda)</p>
                    <div className="flex flex-col gap-1">
                      <LinhaTaxa label={`Comissao (${fmtPct(comissaoShopeePct(resultadoShopee.preco))})`} valor={formatBRL(resultadoShopee.comissao)} />
                      <LinhaTaxa label="Taxa fixa" valor={formatBRL(resultadoShopee.fixa)} />
                      <LinhaTaxa label={`Imposto (${impostoPct}%)`} valor={formatBRL(resultadoShopee.imposto)} />
                      <LinhaTaxa label={`Ads (${adsShopeePct}%)`} valor={formatBRL(resultadoShopee.ads)} />
                      {usaAfiliadoShopee && <LinhaTaxa label={`Afiliado (${afiliadoShopeePct}%)`} valor={formatBRL(resultadoShopee.afiliado)} />}
                      <LinhaTaxa label="Custo do produto" valor={formatBRL(custoBaseProduto)} />
                      {toNum(embalagemPrecificacao) > 0 && <LinhaTaxa label="Embalagem" valor={formatBRL(toNum(embalagemPrecificacao))} />}
                      <div className="mt-1 border-t border-gray-200 dark:border-[#23232b] pt-1">
                        <LinhaTaxa label="Lucro liquido" valor={formatBRL(resultadoShopee.lucro)} destaque />
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-gray-400 dark:text-[#5c5c66]">Regra oficial 2026: preco maior ou igual a R$80 paga 14% + taxa fixa por faixa. Preco menor que R$80 paga 20% + R$4 fixo.</p>
                  </div>
                </div>
              </div>
            </Card>
</div>
            )}
          </div>
        </div>
      )}
    </div>
      )}

      </div>
  );
}

