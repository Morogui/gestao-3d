"use client";

import { useMemo, useState } from "react";
import {
  taxaPesoML,
  comissaoShopeePct,
  taxaFixaShopee,
  COMISSAO_ML_CLASSICO_PCT,
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

function toNum(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtPct(v: number): string {
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

const LOGO_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA+AAAAFkCAIAAAAv+8bNAABATUlEQVR4nO3deVzU1f7H8e+wKJvgAu6QZuKWGwjkUlmZ125lZZZWGrfEfcncM9e0XHHFJVNzTSv1mqVXzS3NBQ3FBPGqiBtu4ILIvszvD34Pf/xmRhhm5nu+B+b1/Kt7GM7nc8cz+ubw/Z6vzt3dXQEAAAAgBwetGwAAAADwfwjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARJy0bsDGvL29mzZtqnUXZUpMTExSUpLWXaB4LH6bY/EDADRR1gJ669atN2zYoHUXZUqPHj22bt2qdRcoHovf5lj8AABNcIkLAAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOgAAACARAjoAAAAgEQI6AAAAIBECOoqRl5endQuANlj8AABNENBRjMzMTK1bALTB4gcAaIKAjmJkZWVp3QKgDRY/AEATBHQU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";

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

const MARGENS_PRESET = [15, 20, 25, 30, 35, 40, 45, 50];

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
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-[#5c5c66]"
        />
        {suffix && <span className="text-xs text-[#5c5c66]">{suffix}</span>}
      </div>
    </label>
  );
}

export default function PainelPage() {
  const [aba, setAba] = useState<"custos" | "precificacao">("custos");

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

  // Falha de impressao (pedido explicito do Guilherme)
  const [falhaPct, setFalhaPct] = useState("5");

  // Custos adicionais
  const [embalagem, setEmbalagem] = useState("");
  const [maoDeObra, setMaoDeObra] = useState("");
  const [frete, setFrete] = useState("");

  // Imposto (usado na aba Precificacao)
  const [impostoPct, setImpostoPct] = useState("6");

  // Precificacao
  const [margemSelecionada, setMargemSelecionada] = useState<number | null>(30);
  const [margemCustom, setMargemCustom] = useState("");
  const [pesoProdutoKg, setPesoProdutoKg] = useState("");
  const [comissaoMLPct, setComissaoMLPct] = useState(String(COMISSAO_ML_CLASSICO_PCT).replace(".", ","));
  const [adsMLPct, setAdsMLPct] = useState("5");
  const [adsShopeePct, setAdsShopeePct] = useState("10");
  const [afiliadoShopeePct, setAfiliadoShopeePct] = useState("0");

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
  const custoMaterial = custoMaterialBruto * fatorFalha;
  const custoManutencao = custoManutencaoBruto * fatorFalha;
  const custoEmbalagem = toNum(embalagem);
  const custoMaoDeObra = toNum(maoDeObra);
  const custoFrete = toNum(frete);

  const custoTotal =
    custoEnergia + custoMaterial + custoManutencao + custoEmbalagem + custoMaoDeObra + custoFrete;

  const margemAlvo = margemSelecionada ?? toNum(margemCustom);
  const pesoKgParaML = toNum(pesoProdutoKg) || toNum(pesoUsado) / 1000;

  const resultadoML = useMemo(() => {
    const preco = resolverPreco({
      custoTotal,
      impostoPct: toNum(impostoPct),
      adsPct: toNum(adsMLPct),
      margemAlvoPct: margemAlvo,
      comissaoPct: () => toNum(comissaoMLPct),
      taxaFixa: () => taxaPesoML(pesoKgParaML),
    });
    const comissao = preco * (toNum(comissaoMLPct) / 100);
    const fixa = taxaPesoML(pesoKgParaML);
    const imposto = preco * (toNum(impostoPct) / 100);
    const ads = preco * (toNum(adsMLPct) / 100);
    const lucro = preco - comissao - fixa - imposto - ads - custoTotal;
    return { preco, comissao, fixa, imposto, ads, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
  }, [custoTotal, impostoPct, adsMLPct, margemAlvo, comissaoMLPct, pesoKgParaML]);

  const resultadoShopee = useMemo(() => {
    const preco = resolverPreco({
      custoTotal,
      impostoPct: toNum(impostoPct),
      adsPct: toNum(adsShopeePct),
      afiliadoPct: toNum(afiliadoShopeePct),
      margemAlvoPct: margemAlvo,
      comissaoPct: (p) => comissaoShopeePct(p),
      taxaFixa: (p) => taxaFixaShopee(p),
    });
    const comissao = preco * (comissaoShopeePct(preco) / 100);
    const fixa = taxaFixaShopee(preco);
    const imposto = preco * (toNum(impostoPct) / 100);
    const ads = preco * (toNum(adsShopeePct) / 100);
    const afiliado = preco * (toNum(afiliadoShopeePct) / 100);
    const lucro = preco - comissao - fixa - imposto - ads - afiliado - custoTotal;
    return { preco, comissao, fixa, imposto, ads, afiliado, lucro, margemPct: preco > 0 ? (lucro / preco) * 100 : 0 };
  }, [custoTotal, impostoPct, adsShopeePct, afiliadoShopeePct, margemAlvo]);

  return (
    <div className="min-h-screen bg-[#0a0a0d] px-4 py-6 sm:px-8">
      <header className="mb-6 flex items-center gap-3">
        <img src={LOGO_DATA_URI} alt="7x7 Escala Ecommerce" className="h-11 w-auto" />
        <div>
          <h1 className="text-lg font-semibold text-white">Calculadora de Custo 3D</h1>
          <p className="text-xs text-[#8b8b96]">
            Descubra quanto custa imprimir e por quanto vender
          </p>
        </div>
      </header>

      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setAba("custos")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium " +
            (aba === "custos" ? "bg-amber-500 text-black" : "bg-[#131318] text-[#8b8b96] border border-[#23232b]")
          }
        >
          Custos
        </button>
        <button
          onClick={() => setAba("precificacao")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium " +
            (aba === "precificacao" ? "bg-amber-500 text-black" : "bg-[#131318] text-[#8b8b96] border border-[#23232b]")
          }
        >
          Precificacao
        </button>
      </div>

      {aba === "custos" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card icon="P1" title="Impressora" subtitle="Consumo medio durante a impressao">
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
            </Card>

            <Card icon="P2" title="Consumo e Operacao" subtitle="Manutencao, energia e falha de impressao">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="Manutencao" value={manutencaoHora} onChange={setManutencaoHora} suffix="R$/h" />
                <Field label="Energia" value={tarifaKwh} onChange={setTarifaKwh} suffix="R$/kWh" />
                <Field label="Falha de impressao" value={falhaPct} onChange={setFalhaPct} suffix="%" />
              </div>
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
              </div>
              <p className="mt-2 text-[11px] text-[#8b8b96]">
                Custo por grama: <span className="text-white">{formatBRL(custoPorGrama)}</span>
              </p>
            </Card>

            <Card icon="P4" title="Custos Extras e Imposto" subtitle="Embalagem, mao de obra, frete e imposto">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Embalagem" value={embalagem} onChange={setEmbalagem} suffix="R$" />
                <Field label="Mao de obra" value={maoDeObra} onChange={setMaoDeObra} suffix="R$" />
                <Field label="Frete" value={frete} onChange={setFrete} suffix="R$" />
                <Field label="Imposto" value={impostoPct} onChange={setImpostoPct} suffix="%" />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-[#5c5c66]">
                Mao de obra e frete sao opcionais. Imposto e usado na aba Precificacao - MEI ~5% do salario minimo (fixo), Simples Nacional varia. Deixe 0 se nao se aplica.
              </p>
            </Card>
          </div>

          <div className="rounded-2xl border border-amber-500/30 bg-[#161108] p-5">
            <p className="text-[11px] text-[#8b8b96]">Custo total de producao</p>
            <p className="mt-1 text-3xl font-bold text-amber-400">{formatBRL(custoTotal)}</p>
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
        </div>
      )}

      {aba === "precificacao" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-2xl border border-[#23232b] bg-[#131318] p-5">
            <div>
              <p className="text-[11px] text-[#8b8b96]">Custo de producao</p>
              <p className="text-2xl font-bold text-green-400">{formatBRL(custoTotal)}</p>
            </div>
            <button onClick={() => setAba("custos")} className="text-xs text-amber-400 hover:underline">
              Editar custos
            </button>
          </div>

          <Card icon="P9" title="Qual sua margem desejada?" subtitle="Selecione a margem de lucro para ver os precos sugeridos">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {MARGENS_PRESET.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMargemSelecionada(m);
                    setMargemCustom("");
                  }}
                  className={
                    "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                    (margemSelecionada === m
                      ? "border-amber-500 bg-[#2a1a0a] text-amber-400"
                      : "border-[#2c2c36] text-[#c8c8d0]")
                  }
                >
                  {m}%
                </button>
              ))}
              <button
                onClick={() => setMargemSelecionada(null)}
                className={
                  "rounded-lg border px-2 py-1.5 text-xs font-medium " +
                  (margemSelecionada === null
                    ? "border-amber-500 bg-[#2a1a0a] text-amber-400"
                    : "border-[#2c2c36] text-[#c8c8d0]")
                }
              >
                Outra
              </button>
            </div>
            {margemSelecionada === null && (
              <div className="mt-2 max-w-[160px]">
                <Field label="Margem liquida desejada" value={margemCustom} onChange={setMargemCustom} suffix="%" />
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card icon="ML" title="Mercado Livre" subtitle="Comissao + taxa fixa por peso + imposto + ads">
              <div className="mb-3 rounded-lg bg-[#0e0e12] p-3">
                <p className="text-[11px] text-[#8b8b96]">Anuncie por</p>
                <p className="text-2xl font-bold text-white">{formatBRL(resultadoML.preco)}</p>
                <div className="mt-2 flex gap-4 text-[11px]">
                  <span className="text-[#8b8b96]">
                    Margem liquida <span className="text-green-400">{fmtPct(resultadoML.margemPct)}</span>
                  </span>
                  <span className="text-[#8b8b96]">
                    Lucro <span className="text-green-400">{formatBRL(resultadoML.lucro)}</span>
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Comissao ML (%)" value={comissaoMLPct} onChange={setComissaoMLPct} suffix="%" />
                <Field label="Ads ML (%)" value={adsMLPct} onChange={setAdsMLPct} suffix="%" />
                <Field label="Peso do produto" value={pesoProdutoKg} onChange={setPesoProdutoKg} suffix="kg" placeholder={(toNum(pesoUsado) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} />
                <div className="flex flex-col justify-end text-[11px] text-[#8b8b96]">
                  Taxa fixa por peso: <span className="text-white">{formatBRL(resultadoML.fixa)}</span>
                </div>
              </div>
            </Card>

            <Card icon="SH" title="Shopee" subtitle="Comissao + taxa fixa automatica + ads + afiliado">
              <div className="mb-3 rounded-lg bg-[#0e0e12] p-3">
                <p className="text-[11px] text-[#8b8b96]">Anuncie por</p>
                <p className="text-2xl font-bold text-white">{formatBRL(resultadoShopee.preco)}</p>
                <div className="mt-2 flex gap-4 text-[11px]">
                  <span className="text-[#8b8b96]">
                    Margem liquida <span className="text-green-400">{fmtPct(resultadoShopee.margemPct)}</span>
                  </span>
                  <span className="text-[#8b8b96]">
                    Lucro <span className="text-green-400">{formatBRL(resultadoShopee.lucro)}</span>
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ads Shopee (%)" value={adsShopeePct} onChange={setAdsShopeePct} suffix="%" />
                <Field label="Afiliado (%)" value={afiliadoShopeePct} onChange={setAfiliadoShopeePct} suffix="%" />
                <div className="col-span-2 text-[11px] text-[#8b8b96]">
                  Comissao automatica: <span className="text-white">{fmtPct(comissaoShopeePct(resultadoShopee.preco))}</span> - Taxa fixa: <span className="text-white">{formatBRL(resultadoShopee.fixa)}</span>
                  <p className="mt-1 text-[10px] text-[#5c5c66]">maior ou igual R$80: 14% + taxa fixa por faixa - menor que R$80: 20% + R$4</p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
