"use client";

import { useMemo, useState } from "react";
import {
  taxaPesoML,
  taxaFixaMLSemFreteGratis,
  comissaoShopeePct,
  taxaFixaShopee,
  COMISSAO_ML_CLASSICO_PCT,
  COMISSAO_ML_PREMIUM_PCT,
  formatBRL,
} from "@/lib/precificacao";

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
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2a1a0a] text-lg">
      {children}
    </div>
  );
}

function Card({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#23232b] bg-[#131318] p-5">
      <div className="mb-4 flex items-start gap-3">
        <IconBadge>{icon}</IconBadge>
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-[#8b8b96]">{subtitle}</p>}
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[#8b8b96]">{label}</span>
      <div className="flex items-center gap-1.5 rounded-lg border border-[#2c2c36] bg-[#0e0e12] px-2.5 py-1.5">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-base text-white outline-none placeholder:text-[#5c5c66] sm:text-sm"
        />
        {suffix && <span className="text-xs text-[#5c5c66]">{suffix}</span>}
      </div>
    </label>
  );
}

function LinhaTaxa({ label, valor, destaque = false }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={destaque ? "text-[#c8c8d0]" : "text-[#8b8b96]"}>{label}</span>
      <span className={destaque ? "font-semibold text-white" : "text-white"}>{valor}</span>
    </div>
  );
}

export default function PainelPage() {
  const [aba, setAba] = useState<"custos" | "precificacao">("precificacao");

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
  const [margemDesejadaPct, setMargemDesejadaPct] = useState("30");
  const [custoProdutoManual, setCustoProdutoManual] = useState("");
  const [pesoProdutoKg, setPesoProdutoKg] = useState("");
  const [comissaoMLPct, setComissaoMLPct] = useState(String(COMISSAO_ML_CLASSICO_PCT).replace(".", ","));
  const [adsMLPct, setAdsMLPct] = useState("5");
  const [adsShopeePct, setAdsShopeePct] = useState("10");
  const [afiliadoShopeePct, setAfiliadoShopeePct] = useState("0");
  const [usaAfiliadoShopee, setUsaAfiliadoShopee] = useState(false);
  const [afiliadoMLPct, setAfiliadoMLPct] = useState("0");
  const [usaAfiliadoML, setUsaAfiliadoML] = useState(false);
  const [tipoAnuncioML, setTipoAnuncioML] = useState<"classico" | "premium">("classico");
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
  const custoParaPrecificacao = toNum(custoProdutoManual) || custoTotal;

  const margemAlvo = toNum(margemDesejadaPct);
  const pesoRealKg = toNum(pesoProdutoKg) || toNum(pesoUsado) / 1000;
  const pesoCubadoKg = (toNum(comprimentoCm) * toNum(larguraCm) * toNum(alturaCm)) / 6000;
  const pesoKgParaML = Math.max(pesoRealKg, pesoCubadoKg || 0);
  const flexLiquidoML = Math.max(0, toNum(custoFlexML) - toNum(reembolsoFlexML));

  const resultadoML = useMemo(() => {
    const afiliadoPctAtivo = usaAfiliadoML ? toNum(afiliadoMLPct) : 0;

    function calcular(comFlex: boolean) {
      const taxaFixaFn = (preco: number) =>
        (freteGratisML ? taxaPesoML(pesoKgParaML, preco) : taxaFixaMLSemFreteGratis(preco)) +
        (comFlex ? flexLiquidoML : 0);
      const preco = resolverPreco({
        custoTotal: custoParaPrecificacao,
        impostoPct: toNum(impostoPct),
        adsPct: toNum(adsMLPct),
        afiliadoPct: afiliadoPctAtivo,
        margemAlvoPct: margemAlvo,
        comissaoPct: () => toNum(comissaoMLPct),
        taxaFixa: taxaFixaFn,
      });
      const comissao = preco * (toNum(comissaoMLPct) / 100);
      const fixa = taxaFixaFn(preco);
      const imposto = preco * (toNum(impostoPct) / 100);
      const ads = preco * (toNum(adsMLPct) / 100);
      const afiliado = preco * (afiliadoPctAtivo / 100);
      const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoParaPrecificacao;
      return { preco, comissao, fixa, imposto, ads, afiliado, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
    }

    const semFlex = calcular(false);
    const comFlex = calcular(true);
    const ativo = usaFlexML ? comFlex : semFlex;
    return { ...ativo, semFlex, comFlex };
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
  ]);

  const resultadoShopee = useMemo(() => {
    const preco = resolverPreco({
      custoTotal: custoParaPrecificacao,
      impostoPct: toNum(impostoPct),
      adsPct: toNum(adsShopeePct),
      afiliadoPct: usaAfiliadoShopee ? toNum(afiliadoShopeePct) : 0,
      margemAlvoPct: margemAlvo,
      comissaoPct: (p) => comissaoShopeePct(p),
      taxaFixa: (p) => taxaFixaShopee(p),
    });
    const comissao = preco * (comissaoShopeePct(preco) / 100);
    const fixa = taxaFixaShopee(preco);
    const imposto = preco * (toNum(impostoPct) / 100);
    const ads = preco * (toNum(adsShopeePct) / 100);
    const afiliado = preco * ((usaAfiliadoShopee ? toNum(afiliadoShopeePct) : 0) / 100);
    const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoParaPrecificacao;
    return { preco, comissao, fixa, imposto, ads, afiliado, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
  }, [custoParaPrecificacao, impostoPct, adsShopeePct, afiliadoShopeePct, margemAlvo, usaAfiliadoShopee]);

  return (
    <div className="min-h-screen bg-[#0a0a0d] px-4 py-6 sm:px-8">
      <header className="mb-6 flex items-center justify-center">
        <img src="/logo-7x7.png" alt="7x7 Escala Ecommerce" className="h-16 w-auto sm:h-28" />
      </header>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setAba("precificacao")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium " +
            (aba === "precificacao" ? "bg-amber-500 text-black" : "bg-[#131318] text-[#8b8b96] border border-[#23232b]")
          }
        >
          Precificação Marketplace
        </button>
        <button
          onClick={() => setAba("custos")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium " +
            (aba === "custos" ? "bg-amber-500 text-black" : "bg-[#131318] text-[#8b8b96] border border-[#23232b]")
          }
        >
          Custo Produto 3D
        </button>
      </div>

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
                      className="rounded-2xl border border-[#23232b] bg-[#131318] px-8 py-6 text-sm font-medium text-white transition hover:border-amber-500 hover:text-amber-400"
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
                            "rounded-lg border px-2 py-1.5 text-left text-[11px] " +
                            (impressora === imp.nome
                              ? "border-amber-500 bg-[#2a1a0a] text-amber-400"
                              : "border-[#2c2c36] text-[#c8c8d0]")
                          }
                        >
                          <div className="font-medium">{imp.nome}</div>
                          <div className="text-[10px] text-[#8b8b96]">~{imp.watts}W medio</div>
                        </button>
                      ))}
                      <button
                        onClick={() => setImpressora("outra")}
                        className={
                          "rounded-lg border px-2 py-1.5 text-left text-[11px] " +
                          (impressora === "outra"
                            ? "border-amber-500 bg-[#2a1a0a] text-amber-400"
                            : "border-[#2c2c36] text-[#c8c8d0]")
                        }
                      >
                        <div className="font-medium">Outra</div>
                        <div className="text-[10px] text-[#8b8b96]">Digitar watts</div>
                      </button>
                    </div>
                    {impressora === "outra" && (
                      <div className="mt-2">
                        <Field label="Potencia (W)" value={wattsCustom} onChange={setWattsCustom} suffix="W" />
                      </div>
                    )}
                    <label className="mt-3 flex items-center gap-2 text-[11px] text-[#8b8b96]">
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
                        className="mt-3 w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400"
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
                      className="mt-2 flex items-center gap-1 text-xs font-medium text-amber-400 transition hover:text-amber-300"
                    >
                      + Mao de obra
                    </button>
                  )}
                  <p className="mt-2 text-[10px] leading-relaxed text-[#5c5c66]">
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
                  <p className="mt-2 text-[11px] text-[#8b8b96]">
                    Custo por grama: <span className="text-white">{formatBRL(custoPorGrama)}</span>
                  </p>
                </Card>

                <Card icon="P4" title="Custos Extras" subtitle="Frete, imposto e desperdicio de material">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Frete" value={frete} onChange={setFrete} suffix="R$" />
                    <Field label="Imposto" value={impostoPct} onChange={setImpostoPct} suffix="%" />
                    <Field label="% de desperdicio" value={desperdicioPct} onChange={setDesperdicioPct} suffix="%" />
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#5c5c66]">
                    Frete e opcional. Imposto e usado na aba Precificacao - MEI ~5% do salario minimo (fixo), Simples Nacional varia. Desperdicio de material aumenta o custo do filamento usado. Deixe 0 se nao se aplica.
                  </p>
                </Card>
              </>
            )}
          </div>

          {impressoraConfirmada && (
            <div className="rounded-2xl border border-amber-500/30 bg-[#161108] p-5">
              <p className="text-[11px] text-[#8b8b96]">Custo total de producao</p>
              <p className="mt-1 text-3xl font-bold text-amber-400">{formatBRL(custoTotal)}</p>
              <p className="mt-1 text-xs text-[#8b8b96]">Custo por peca ({qtdPecas}un): <span className="text-white font-semibold">{formatBRL(custoPorPeca)}</span></p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-[#5c5c66]">Energia</p>
                  <p className="text-white">{formatBRL(custoEnergia)}</p>
                </div>
                <div>
                  <p className="text-[#5c5c66]">Material</p>
                  <p className="text-white">{formatBRL(custoMaterial)}</p>
                </div>
                <div>
                  <p className="text-[#5c5c66]">Manutencao</p>
                  <p className="text-white">{formatBRL(custoManutencao)}</p>
                </div>
                <div>
                  <p className="text-[#5c5c66]">Embalagem</p>
                  <p className="text-white">{formatBRL(custoEmbalagem)}</p>
                </div>
                <div>
                  <p className="text-[#5c5c66]">Mao de obra</p>
                  <p className="text-white">{formatBRL(custoMaoDeObra)}</p>
                </div>
                <div>
                  <p className="text-[#5c5c66]">Frete</p>
                  <p className="text-white">{formatBRL(custoFrete)}</p>
                </div>
              </div>
              {falhaFrac > 0 && (
                <p className="mt-3 text-[10px] text-[#5c5c66]">
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
          <div className="rounded-2xl border border-[#23232b] bg-[#131318] p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-[220px] flex-1">
                <Field
                  label="Custo do produto (por peca)"
                  value={custoProdutoManual}
                  onChange={setCustoProdutoManual}
                  suffix="R$"
                  placeholder={custoTotal > 0 ? custoTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}
                />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-[#8b8b96]">Custo usado no calculo</p>
                <p className="text-xl font-bold text-green-400">{formatBRL(custoParaPrecificacao)}</p>
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#5c5c66]">
              Digite aqui o custo real do seu produto (essa aba funciona sozinha, sem depender da aba Custo Produto 3D). Se preferir, use a aba Custo Produto 3D so como apoio pra chegar nesse numero.
            </p>
          </div>

          <Card icon="P9" title="Margem e imposto" subtitle="Digite a margem de lucro que voce quer e o imposto que voce paga por venda">
            <div className="grid max-w-[320px] grid-cols-2 gap-2">
              <Field label="Margem liquida desejada" value={margemDesejadaPct} onChange={setMargemDesejadaPct} suffix="%" />
              <Field label="Imposto (%)" value={impostoPct} onChange={setImpostoPct} suffix="%" />
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-[#5c5c66]">
              Imposto: MEI ~5% do salario minimo (fixo), Simples Nacional varia - confirme com sua contadora.
            </p>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card icon="ML" title="Mercado Livre" subtitle="Comissao + taxa fixa por peso + imposto + ads">
              <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg bg-[#0e0e12] p-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-[#8b8b96]">Preco de venda</p>
                  <p className="text-2xl font-bold text-white">{formatBRL(resultadoML.preco)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#8b8b96]">Preco para anunciar (+30%)</p>
                  <p className="text-2xl font-bold text-amber-400">{formatBRL(resultadoML.preco * 1.3)}</p>
                </div>
                <p className="col-span-1 text-[10px] leading-relaxed text-[#5c5c66] sm:col-span-2">
                  Anuncie pelo preco maior pra abrir espaco pra promocao/cupom na central de promocoes sem furar sua margem. O preco de venda real (o que voce recebe liquido) e sempre o da esquerda.
                </p>
                <div className="col-span-1 mt-1 flex gap-4 text-[11px] sm:col-span-2">
                  <span className="text-[#8b8b96]">
                    Margem liquida <span className="text-green-400">{fmtPct(resultadoML.margemPct)}</span>
                  </span>
                  <span className="text-[#8b8b96]">
                    Lucro <span className="text-green-400">{formatBRL(resultadoML.lucro)}</span>
                  </span>
                </div>
              </div>

              <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-[#c8c8d0]">Tipo de anuncio</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTipoAnuncioML("classico");
                        setComissaoMLPct(String(COMISSAO_ML_CLASSICO_PCT).replace(".", ","));
                      }}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (tipoAnuncioML === "classico" ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                      }
                    >
                      Classico
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTipoAnuncioML("premium");
                        setComissaoMLPct(String(COMISSAO_ML_PREMIUM_PCT).replace(".", ","));
                      }}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (tipoAnuncioML === "premium" ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                      }
                    >
                      Premium
                    </button>
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-[#c8c8d0]">Frete gratis pro comprador?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFreteGratisML(true)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (freteGratisML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                      }
                    >
                      Sim
                    </button>
                    <button
                      type="button"
                      onClick={() => setFreteGratisML(false)}
                      className={
                        "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                        (!freteGratisML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                      }
                    >
                      Nao
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Comissao ML (%)" value={comissaoMLPct} onChange={setComissaoMLPct} suffix="%" />
                <Field label="Ads ML (%)" value={adsMLPct} onChange={setAdsMLPct} suffix="%" />
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#5c5c66]">
                Comissao: taxa que o Mercado Livre cobra sobre o preco de venda (Classico ~{COMISSAO_ML_CLASSICO_PCT}%, Premium ~{COMISSAO_ML_PREMIUM_PCT}% - clique acima ou ajuste o numero manualmente). Ads: seu investimento em Mercado Ads sobre a venda.
              </p>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Field label="Peso do produto" value={pesoProdutoKg} onChange={setPesoProdutoKg} suffix="kg" placeholder={(toNum(pesoUsado) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} />
                <Field label="Comprimento" value={comprimentoCm} onChange={setComprimentoCm} suffix="cm" />
                <Field label="Largura" value={larguraCm} onChange={setLarguraCm} suffix="cm" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Altura" value={alturaCm} onChange={setAlturaCm} suffix="cm" />
                <div className="flex flex-col justify-end text-[11px] text-[#8b8b96]">
                  Taxa fixa cobrada: <span className="text-white">{formatBRL(resultadoML.fixa)}</span>
                </div>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#5c5c66]">
                A taxa fixa do ML muda conforme voce oferece frete gratis ou nao, e tambem e por faixa de peso/preco (tabela oficial do ML, valida a partir de 24/08/2026). Se a caixa (C x L x A) resultar num peso cubado maior que o peso real do produto, o ML cobra pelo cubado - preencha as dimensoes pra ver a taxa correta.
              </p>

              <div className="mt-3 border-t border-[#23232b] pt-3">
                <p className="mb-1.5 text-[11px] font-medium text-[#c8c8d0]">Voce envia por Mercado Envios Flex?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUsaFlexML(false)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (!usaFlexML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                    }
                  >
                    Nao uso Flex
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsaFlexML(true)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (usaFlexML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
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
                <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-[#0e0e12] p-3">
                  <div>
                    <p className="text-[11px] text-[#8b8b96]">Vendendo sem Flex</p>
                    <p className="text-lg font-bold text-white">{formatBRL(resultadoML.semFlex.preco)}</p>
                    <p className="text-[10px] text-[#8b8b96]">Lucro <span className="text-green-400">{formatBRL(resultadoML.semFlex.lucro)}</span></p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#8b8b96]">Vendendo com Flex</p>
                    <p className="text-lg font-bold text-white">{formatBRL(resultadoML.comFlex.preco)}</p>
                    <p className="text-[10px] text-[#8b8b96]">Lucro <span className="text-green-400">{formatBRL(resultadoML.comFlex.lucro)}</span></p>
                  </div>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-[#5c5c66]">
                  O Flex tem um custo de entrega que o ML repassa e reembolsa parte dele. Preencha os dois valores reais (confira no seu extrato) pra comparar quanto voce recebe liquido vendendo com Flex e sem Flex.
                </p>
              </div>

              <div className="mt-3 border-t border-[#23232b] pt-3">
                <p className="mb-1.5 text-[11px] font-medium text-[#c8c8d0]">Participa do programa de parceiros (afiliados)?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUsaAfiliadoML(false)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (!usaAfiliadoML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                    }
                  >
                    Nao uso afiliados
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsaAfiliadoML(true)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (usaAfiliadoML ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
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
                <p className="mt-1 text-[10px] leading-relaxed text-[#5c5c66]">
                  Parceiros Mercado Livre: comissao paga a criadores/afiliados que divulgam seu produto - so entra na conta se voce marcar "Uso afiliados" acima.
                </p>
              </div>

              <div className="mt-3 rounded-lg bg-[#0e0e12] p-3 text-[11px]">
                <p className="mb-2 font-medium text-[#c8c8d0]">Detalhamento das taxas (sobre o preco de venda)</p>
                <div className="flex flex-col gap-1">
                  <LinhaTaxa label={`Comissao (${comissaoMLPct}%)`} valor={formatBRL(resultadoML.comissao)} />
                  <LinhaTaxa label="Taxa fixa de envio" valor={formatBRL(resultadoML.fixa)} />
                  <LinhaTaxa label={`Imposto (${impostoPct}%)`} valor={formatBRL(resultadoML.imposto)} />
                  <LinhaTaxa label={`Ads (${adsMLPct}%)`} valor={formatBRL(resultadoML.ads)} />
                  {usaAfiliadoML && <LinhaTaxa label={`Afiliado (${afiliadoMLPct}%)`} valor={formatBRL(resultadoML.afiliado)} />}
                  <LinhaTaxa label="Custo do produto" valor={formatBRL(custoParaPrecificacao)} />
                  <div className="mt-1 border-t border-[#23232b] pt-1">
                    <LinhaTaxa label="Lucro liquido" valor={formatBRL(resultadoML.lucro)} destaque />
                  </div>
                </div>
              </div>
            </Card>

            <Card icon="SH" title="Shopee" subtitle="Comissao + taxa fixa automatica + ads + afiliado">
              <div className="mb-3 grid grid-cols-1 gap-2 rounded-lg bg-[#0e0e12] p-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-[#8b8b96]">Preco de venda</p>
                  <p className="text-2xl font-bold text-white">{formatBRL(resultadoShopee.preco)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#8b8b96]">Preco para anunciar (+30%)</p>
                  <p className="text-2xl font-bold text-amber-400">{formatBRL(resultadoShopee.preco * 1.3)}</p>
                </div>
                <p className="col-span-1 text-[10px] leading-relaxed text-[#5c5c66] sm:col-span-2">
                  Anuncie pelo preco maior pra abrir espaco pra promocao/cupom na central de promocoes sem furar sua margem. O preco de venda real (o que voce recebe liquido) e sempre o da esquerda.
                </p>
                <div className="col-span-1 mt-1 flex gap-4 text-[11px] sm:col-span-2">
                  <span className="text-[#8b8b96]">
                    Margem liquida <span className="text-green-400">{fmtPct(resultadoShopee.margemPct)}</span>
                  </span>
                  <span className="text-[#8b8b96]">
                    Lucro <span className="text-green-400">{formatBRL(resultadoShopee.lucro)}</span>
                  </span>
                </div>
              </div>

              <div className="mb-2">
                <p className="mb-1.5 text-[11px] font-medium text-[#c8c8d0]">Participa do programa de afiliados?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setUsaAfiliadoShopee(false)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (!usaAfiliadoShopee ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                    }
                  >
                    Nao uso afiliados
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsaAfiliadoShopee(true)}
                    className={
                      "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                      (usaAfiliadoShopee ? "border-amber-500 bg-[#2a1a0a] text-amber-400" : "border-[#2c2c36] text-[#c8c8d0]")
                    }
                  >
                    Uso afiliados
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ads Shopee (%)" value={adsShopeePct} onChange={setAdsShopeePct} suffix="%" />
                {usaAfiliadoShopee && (
                  <Field label="Afiliado (%)" value={afiliadoShopeePct} onChange={setAfiliadoShopeePct} suffix="%" />
                )}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[#5c5c66]">
                Ads: seu investimento em Shopee Ads sobre a venda. Afiliado: comissao paga a criadores de conteudo/afiliados que divulgam seu produto - so entra na conta se voce marcar "Uso afiliados" acima.
              </p>

              <div className="mt-2 rounded-lg bg-[#0e0e12] p-3 text-[11px]">
                <p className="mb-2 font-medium text-[#c8c8d0]">Detalhamento das taxas (sobre o preco de venda)</p>
                <div className="flex flex-col gap-1">
                  <LinhaTaxa label={`Comissao (${fmtPct(comissaoShopeePct(resultadoShopee.preco))})`} valor={formatBRL(resultadoShopee.comissao)} />
                  <LinhaTaxa label="Taxa fixa" valor={formatBRL(resultadoShopee.fixa)} />
                  <LinhaTaxa label={`Imposto (${impostoPct}%)`} valor={formatBRL(resultadoShopee.imposto)} />
                  <LinhaTaxa label={`Ads (${adsShopeePct}%)`} valor={formatBRL(resultadoShopee.ads)} />
                  {usaAfiliadoShopee && <LinhaTaxa label={`Afiliado (${afiliadoShopeePct}%)`} valor={formatBRL(resultadoShopee.afiliado)} />}
                  <LinhaTaxa label="Custo do produto" valor={formatBRL(custoParaPrecificacao)} />
                  <div className="mt-1 border-t border-[#23232b] pt-1">
                    <LinhaTaxa label="Lucro liquido" valor={formatBRL(resultadoShopee.lucro)} destaque />
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-[#5c5c66]">Regra oficial 2026: preco maior ou igual a R$80 paga 14% + taxa fixa por faixa. Preco menor que R$80 paga 20% + R$4 fixo.</p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
