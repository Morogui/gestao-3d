"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ConfigPrecificacao,
  DEFAULT_CONFIG_PRECIFICACAO,
  ResultadoPlataforma,
  formatBRL,
} from "@/lib/precificacao";

const c = React.createElement;

interface ProdutoPrecificacao {
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
  usaAdsML: boolean;
  usaAfiliadoML: boolean;
  usaAdsShopee: boolean;
  usaAfiliadoShopee: boolean;
  resultadoML: ResultadoPlataforma | null;
  resultadoShopee: ResultadoPlataforma | null;
}

type AbaPlataforma = "todos" | "ml" | "shopee";

// 14/09/2026 -- campos booleanos que podem ser marcados/restaurados em
// massa por coluna (botão "marcar todos" no cabeçalho). Ads e Afiliado
// são mutuamente exclusivos por plataforma (ver toggleAdsML etc. em
// ProdutoRow), então marcar um em massa também precisa desmarcar o
// parceiro em massa -- e restaurar precisa devolver os dois ao valor
// que cada produto tinha antes do flag.
type CampoBulk =
  | "usaAdsML"
  | "usaAfiliadoML"
  | "enviadoPorFlexML"
  | "usaAdsShopee"
  | "usaAfiliadoShopee";

const PARCEIRO_EXCLUSIVO: Partial<Record<CampoBulk, CampoBulk>> = {
  usaAdsML: "usaAfiliadoML",
  usaAfiliadoML: "usaAdsML",
  usaAdsShopee: "usaAfiliadoShopee",
  usaAfiliadoShopee: "usaAdsShopee",
};

// 14/09/2026 -- monta o patch de um toggle em massa sem usar chave
// computada em cima de ProdutoPrecificacao (index signature genérica
// ali não bate limpo com a interface, que tem campos de tipos
// diferentes). Cada branch devolve um objeto literal com nome de
// campo real, então o TypeScript valida a forma exata sem precisar
// de "as".
function construirPatchBulk(
  campo: CampoBulk,
  valor: boolean,
  valorParceiro?: boolean
): Partial<ProdutoPrecificacao> {
  switch (campo) {
    case "usaAdsML":
      return valorParceiro === undefined
        ? { usaAdsML: valor }
        : { usaAdsML: valor, usaAfiliadoML: valorParceiro };
    case "usaAfiliadoML":
      return valorParceiro === undefined
        ? { usaAfiliadoML: valor }
        : { usaAfiliadoML: valor, usaAdsML: valorParceiro };
    case "usaAdsShopee":
      return valorParceiro === undefined
        ? { usaAdsShopee: valor }
        : { usaAdsShopee: valor, usaAfiliadoShopee: valorParceiro };
    case "usaAfiliadoShopee":
      return valorParceiro === undefined
        ? { usaAfiliadoShopee: valor }
        : { usaAfiliadoShopee: valor, usaAdsShopee: valorParceiro };
    case "enviadoPorFlexML":
      return { enviadoPorFlexML: valor };
  }
}

function normalizarBusca(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}

export default function PrecificacaoPage() {
  const [config, setConfig] = useState<ConfigPrecificacao>(
    DEFAULT_CONFIG_PRECIFICACAO
  );
  const [configSalva, setConfigSalva] = useState(true);
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [produtos, setProdutos] = useState<ProdutoPrecificacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<AbaPlataforma>("todos");
  // 14/09/2026 -- pedido do Guilherme: quando um anúncio é inativado
  // ele não deve mais aparecer na lista por padrão. O campo "Mostrar
  // inativos" continua existindo pra quem quiser ver -- só o padrão
  // mudou de ligado pra desligado (antes vinha true).
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // 14/09/2026 -- guarda, por coluna (campo booleano), o valor que
  // cada produto tinha ANTES de "marcar todos" ser clicado. Enquanto
  // a coluna estiver com snapshot salvo aqui, o checkbox do cabeçalho
  // fica marcado (modo "todos ligados"); clicar de novo restaura cada
  // produto pro valor salvo, em vez de simplesmente desligar tudo.
  const [bulkSnapshots, setBulkSnapshots] = useState<
    Partial<
      Record<CampoBulk, Record<number, { valor: boolean; parceiro?: boolean }>>
    >
  >({});

  // 06/09/2026 -- ref sempre sincronizado com o produtos state mais
  // recente. Corrige uma race condition: os controles que chamam
  // setTimeout(onSalvar, 0) logo depois de onChangeLocal (checkbox
  // Flex, botoes Inativar/Reativar) capturavam o onSalvar de ANTES da
  // mudanca -- a closure antiga apontava pro produtos state de antes
  // do toggle, entao o PUT sempre reenviava o valor anterior, sem a
  // mudanca que o usuario acabou de clicar. Lendo do ref (sempre
  // atualizado pelo efeito abaixo) em vez do array direto, o valor
  // salvo passa a ser sempre o mais recente, nao importa quando o
  // setTimeout dispara.
  const produtosRef = useRef<ProdutoPrecificacao[]>(produtos);
  useEffect(() => {
    produtosRef.current = produtos;
  }, [produtos]);

  async function carregarTudo() {
    const [configRes, produtosRes] = await Promise.all([
      fetch("/api/precificacao/config"),
      fetch("/api/precificacao/produtos"),
    ]);
    const configData = await configRes.json();
    const produtosData = await produtosRes.json();
    setConfig(configData);
    setProdutos(produtosData);
    setLoading(false);
  }

  useEffect(() => {
    carregarTudo();
  }, []);

  const produtosFiltrados = useMemo(() => {
    const alvo = normalizarBusca(busca);
    if (!alvo) return produtos;
    return produtos.filter(
      (p) =>
        normalizarBusca(p.nome).includes(alvo) ||
        normalizarBusca(p.sku).includes(alvo)
    );
  }, [produtos, busca]);

  // 06/09/2026 -- aplica o filtro de "mostrar inativos". Um produto e
  // considerado inativo no contexto da aba atual quando: na aba ML,
  // ativoML=false; na aba Shopee, ativoShopee=false; na aba Todos,
  // quando esta inativo nas DUAS plataformas ao mesmo tempo (senao um
  // produto vendido so numa das duas sumiria da visao geral).
  const produtosVisiveis = useMemo(() => {
    if (mostrarInativos) return produtosFiltrados;
    return produtosFiltrados.filter((p) => {
      if (aba === "ml") return p.ativoML;
      if (aba === "shopee") return p.ativoShopee;
      return p.ativoML || p.ativoShopee;
    });
  }, [produtosFiltrados, mostrarInativos, aba]);

  function updateConfig<K extends keyof ConfigPrecificacao>(
    key: K,
    value: number
  ) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setConfigSalva(false);
  }

  async function handleSalvarConfig() {
    setSalvandoConfig(true);
    try {
      const res = await fetch("/api/precificacao/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const salvo = await res.json();
      setConfig(salvo);
      setConfigSalva(true);
      const produtosRes = await fetch("/api/precificacao/produtos");
      setProdutos(await produtosRes.json());
    } finally {
      setSalvandoConfig(false);
    }
  }

  // 14/09/2026 -- monta o payload de PUT a partir de um produto. Foi
  // separado de salvarProduto pra poder ser reaproveitado pelo toggle
  // em massa (que dispara vários PUTs em paralelo e só refaz o GET
  // uma vez no final, em vez de um GET inteiro por produto).
  function construirPayload(produto: ProdutoPrecificacao) {
    return {
      produtoId: produto.id,
      // 08/09/2026 -- SKUs "compostos"/kit (id negativo, ver rota)
      // nao tem uma linha propria em `produtos`: o backend precisa
      // do SKU pra saber em qual registro salvar o override. Mandar
      // sempre (mesmo pros produtos normais, onde e so ignorado) e
      // mais simples do que ter dois formatos de payload.
      sku: produto.sku,
      pesoEnvioKg: produto.pesoEnvioKg,
      precoVendaML: produto.precoVendaML,
      precoVendaShopee: produto.precoVendaShopee,
      enviadoPorFlexML: produto.enviadoPorFlexML,
      embalagemCusto: produto.embalagemCusto,
      margemDesejadaPct: produto.margemDesejadaPct,
      custoProducao:
        produto.custoProducao !== produto.custoProducaoCalculado
          ? produto.custoProducao
          : null,
      ativoML: produto.ativoML,
      ativoShopee: produto.ativoShopee,
      reembolsoFlexML: produto.reembolsoFlexML,
      usaAdsML: produto.usaAdsML,
      usaAfiliadoML: produto.usaAfiliadoML,
      usaAdsShopee: produto.usaAdsShopee,
      usaAfiliadoShopee: produto.usaAfiliadoShopee,
    };
  }

  async function salvarProdutoPut(produto: ProdutoPrecificacao) {
    await fetch("/api/precificacao/produtos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(construirPayload(produto)),
    });
  }

  async function salvarProduto(produto: ProdutoPrecificacao) {
    await salvarProdutoPut(produto);
    const produtosRes = await fetch("/api/precificacao/produtos");
    setProdutos(await produtosRes.json());
  }

  function updateProdutoLocal(
    id: number,
    patch: Partial<ProdutoPrecificacao>
  ) {
    setProdutos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }

  // 14/09/2026 -- botão "marcar todos" do cabeçalho de cada coluna de
  // checkbox (Ads ML, Afiliado ML, Flex, Ads Shopee, Afiliado
  // Shopee). Primeiro clique: guarda o valor atual de cada produto
  // (e do campo parceiro, quando exclusivo) e marca todos como true.
  // Segundo clique (com o snapshot ainda guardado): devolve cada
  // produto exatamente pro valor que tinha antes -- não é só
  // "desmarcar tudo".
  async function toggleBulkColuna(campo: CampoBulk) {
    const parceiro = PARCEIRO_EXCLUSIVO[campo];
    const snapshotAtual = bulkSnapshots[campo];
    const atuais = produtosRef.current;

    if (snapshotAtual) {
      const atualizados = atuais.map((p) => {
        const guardado = snapshotAtual[p.id];
        if (!guardado) return p;
        return {
          ...p,
          ...construirPatchBulk(campo, guardado.valor, guardado.parceiro),
        };
      });
      setProdutos(atualizados);
      setBulkSnapshots((prev) => {
        const copia = { ...prev };
        delete copia[campo];
        return copia;
      });
      await Promise.all(
        atualizados
          .filter((p) => snapshotAtual[p.id] !== undefined)
          .map((p) => salvarProdutoPut(p))
      );
    } else {
      const snap: Record<number, { valor: boolean; parceiro?: boolean }> = {};
      atuais.forEach((p) => {
        snap[p.id] = {
          valor: p[campo],
          parceiro: parceiro ? p[parceiro] : undefined,
        };
      });
      const atualizados = atuais.map((p) => ({
        ...p,
        ...construirPatchBulk(campo, true, parceiro ? false : undefined),
      }));
      setProdutos(atualizados);
      setBulkSnapshots((prev) => ({ ...prev, [campo]: snap }));
      await Promise.all(atualizados.map((p) => salvarProdutoPut(p)));
    }

    const produtosRes = await fetch("/api/precificacao/produtos");
    setProdutos(await produtosRes.json());
  }

  if (loading) {
    return c(
      "div",
      {
        className:
          "rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500",
      },
      "Carregando precificação..."
    );
  }

  const abas: { id: AbaPlataforma; label: string }[] = [
    { id: "todos", label: "Todos" },
    { id: "ml", label: "Mercado Livre" },
    { id: "shopee", label: "Shopee" },
  ];

  const mostrarML = aba !== "shopee";
  const mostrarShopee = aba !== "ml";
  // 14/09/2026 -- "Todos" agora é uma visão somente-leitura: reflete o
  // estado combinado das duas plataformas, mas não deixa editar nada
  // por ali (edição só nas abas Mercado Livre / Shopee, onde fica
  // claro em qual plataforma a mudança está sendo feita).
  const somenteLeitura = aba === "todos";
  const colSpanDetalhes =
    3 + (mostrarML ? 7 : 0) + (mostrarShopee ? 5 : 0) + 1;

  return c(
    "div",
    { className: "flex flex-col gap-6" },
    c(
      "section",
      { className: "rounded-lg border border-gray-200 bg-white p-5" },
      c(
        "div",
        { className: "mb-4 flex items-center justify-between" },
        c(
          "h2",
          { className: "text-sm font-semibold text-gray-900" },
          "Configuração geral"
        ),
        c(
          "div",
          { className: "flex items-center gap-2" },
          configSalva
            ? c("span", { className: "text-xs text-gray-400" }, "Salvo")
            : c(
                "span",
                { className: "text-xs text-amber-600" },
                "Alterações não salvas"
              ),
          c(
            "button",
            {
              type: "button",
              onClick: handleSalvarConfig,
              disabled: salvandoConfig || configSalva,
              className:
                "rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40",
            },
            salvandoConfig ? "Salvando..." : "Salvar configuração"
          )
        )
      ),
      c(
        "p",
        { className: "mb-4 rounded-md bg-blue-50 p-3 text-xs text-blue-900" },
        "Comissão ML (11,5% Clássico), tarifa por peso do ML e comissão + tarifa fixa da Shopee já vêm calibradas com dados reais verificados em 19/08/2026 — não precisam de ajuste manual. Embalagem e Reembolso Flex ML agora são configurados por produto, direto na tabela abaixo (o reembolso varia por peso/tamanho de cada produto, não faz sentido um valor único pra conta inteira). Ads e Afiliado também passaram a ter um check por produto na tabela (igual o Flex) — o % abaixo é o valor usado quando o check está marcado, mas se o produto está ou não usando cada modalidade agora se decide linha a linha. Margem ML/Shopee mostra a margem real considerando exatamente o que está marcado pra aquele produto. Imposto, os percentuais de ADS/afiliado e o Custo do Flex ML continuam editáveis aqui e ainda precisam de confirmação."
      ),
      c(
        "div",
        { className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6" },
        c(NumberField, {
          label: "Imposto (%)",
          value: config.impostoPct,
          onChange: (v: number) => updateConfig("impostoPct", v),
          step: 0.1,
          pendente: true,
        }),
        c(NumberField, {
          label: "ADS Mercado Livre (%)",
          value: config.adsPctML,
          onChange: (v: number) => updateConfig("adsPctML", v),
          step: 0.5,
        }),
        c(NumberField, {
          label: "Afiliado Mercado Livre (%)",
          value: config.afiliadoPctML,
          onChange: (v: number) => updateConfig("afiliadoPctML", v),
          step: 0.5,
          pendente: true,
        }),
        c(NumberField, {
          label: "ADS Shopee (%)",
          value: config.adsPctShopee,
          onChange: (v: number) => updateConfig("adsPctShopee", v),
          step: 0.5,
        }),
        c(NumberField, {
          label: "Afiliado Shopee (%)",
          value: config.afiliadoPctShopee,
          onChange: (v: number) => updateConfig("afiliadoPctShopee", v),
          step: 0.5,
          pendente: true,
        }),
        c(NumberField, {
          label: "Custo Flex ML (R$)",
          value: config.custoFlexML,
          onChange: (v: number) => updateConfig("custoFlexML", v),
          step: 0.1,
          pendente: true,
        })
      )
    ),
    c(
      "section",
      null,
      c(
        "div",
        {
          className:
            "mb-3 flex flex-wrap items-center justify-between gap-2",
        },
        c(
          "h2",
          { className: "text-sm font-semibold text-gray-900" },
          "Produtos",
          c(
            "span",
            { className: "ml-2 font-normal text-gray-400" },
            "(",
            produtosVisiveis.length,
            produtosVisiveis.length !== produtos.length
              ? ` de ${produtos.length}`
              : "",
            ")"
          )
        ),
        c(
          "div",
          { className: "flex items-center gap-3" },
          c(
            "label",
            {
              className:
                "flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-500",
            },
            c("input", {
              type: "checkbox",
              checked: mostrarInativos,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setMostrarInativos(e.target.checked),
              className: "h-3.5 w-3.5",
            }),
            "Mostrar inativos"
          ),
          c(
            "div",
            { className: "relative w-full sm:w-64" },
            c("input", {
              type: "text",
              value: busca,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setBusca(e.target.value),
              placeholder: "Buscar por nome ou SKU...",
              className:
                "w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-7 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
            }),
            c(
              "span",
              {
                className:
                  "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400",
              },
              "\u{1F50D}"
            )
          )
        )
      ),
      c(
        "div",
        { className: "mb-3 flex gap-1 border-b border-gray-200" },
        abas.map((item) =>
          c(
            "button",
            {
              key: item.id,
              type: "button",
              onClick: () => setAba(item.id),
              className:
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                (aba === item.id
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-400 hover:text-gray-600"),
            },
            item.label
          )
        )
      ),
      somenteLeitura
        ? c(
            "p",
            { className: "mb-3 text-xs text-gray-400" },
            "Visão somente leitura — combina o estado das duas plataformas. Pra editar, use a aba Mercado Livre ou Shopee."
          )
        : null,
      produtosVisiveis.length === 0
        ? c(
            "div",
            {
              className:
                "rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500",
            },
            produtos.length === 0
              ? "Nenhum produto encontrado. Cadastre produtos na aba Custo primeiro."
              : "Nenhum produto ativo encontrado com esse filtro."
          )
        : c(
            "div",
            {
              className:
                "overflow-x-auto rounded-lg border border-gray-200 bg-white",
            },
            c(
              "table",
              { className: "min-w-full divide-y divide-gray-200 text-sm" },
              c(
                "thead",
                {
                  className:
                    "bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500",
                },
                c(
                  "tr",
                  null,
                  c("th", { className: "px-3 py-3" }, "Produto"),
                  c(
                    "th",
                    { className: "px-3 py-3 text-right" },
                    "Peso envio (kg)"
                  ),
                  c(
                    "th",
                    {
                      className: "px-3 py-3 text-right",
                      title:
                        "Custo do conjunto vendido (kit 1/2/3, corpo+gancho etc). Por padrão vem da placa (1 peça) ou, se o SKU já é um kit composto (só existe em sku_placa), da soma das placas componentes; edite quando precisar ajustar manualmente.",
                    },
                    "Custo produção"
                  ),
                  c(
                    "th",
                    { className: "px-3 py-3 text-right" },
                    "Embalagem (R$)"
                  ),
                  ...(mostrarML
                    ? [
                        c(
                          "th",
                          {
                            key: "th-preco-ml",
                            className: "px-3 py-3 text-right",
                          },
                          "Preço ML"
                        ),
                        c(
                          "th",
                          {
                            key: "th-ads-ml",
                            className: "px-3 py-3 text-center",
                            title:
                              "Considera o custo de Ads (Mercado Ads) no cálculo da margem deste produto",
                          },
                          c(CabecalhoComBulk, {
                            label: "Ads ML",
                            mostrarToggle: aba === "ml",
                            ativo: !!bulkSnapshots.usaAdsML,
                            onToggle: () => toggleBulkColuna("usaAdsML"),
                          })
                        ),
                        c(
                          "th",
                          {
                            key: "th-afiliado-ml",
                            className: "px-3 py-3 text-center",
                            title:
                              "Considera comissão de Parceiros/afiliados no cálculo da margem deste produto",
                          },
                          c(CabecalhoComBulk, {
                            label: "Afiliado ML",
                            mostrarToggle: aba === "ml",
                            ativo: !!bulkSnapshots.usaAfiliadoML,
                            onToggle: () => toggleBulkColuna("usaAfiliadoML"),
                          })
                        ),
                        c(
                          "th",
                          {
                            key: "th-flex",
                            className: "px-3 py-3 text-center",
                          },
                          c(CabecalhoComBulk, {
                            label: "Flex",
                            mostrarToggle: aba === "ml",
                            ativo: !!bulkSnapshots.enviadoPorFlexML,
                            onToggle: () =>
                              toggleBulkColuna("enviadoPorFlexML"),
                          })
                        ),
                        c(
                          "th",
                          {
                            key: "th-reembolso-flex",
                            className: "px-3 py-3 text-right",
                            title:
                              "Reembolso do Mercado Envios Flex pra este produto (varia por peso/tamanho). Só entra na conta quando Flex está marcado.",
                          },
                          "Reembolso Flex (R$)"
                        ),
                        c(
                          "th",
                          {
                            key: "th-lucro-ml",
                            className: "px-3 py-3 text-right",
                          },
                          "Lucro ML (R$)"
                        ),
                        c(
                          "th",
                          {
                            key: "th-margem-ml",
                            className: "px-3 py-3 text-right",
                          },
                          "Margem ML"
                        ),
                      ]
                    : []),
                  ...(mostrarShopee
                    ? [
                        c(
                          "th",
                          {
                            key: "th-preco-shopee",
                            className: "px-3 py-3 text-right",
                          },
                          "Preço Shopee"
                        ),
                        c(
                          "th",
                          {
                            key: "th-ads-shopee",
                            className: "px-3 py-3 text-center",
                            title:
                              "Considera o custo de Ads (Shopee Ads) no cálculo da margem deste produto",
                          },
                          c(CabecalhoComBulk, {
                            label: "Ads Shopee",
                            mostrarToggle: aba === "shopee",
                            ativo: !!bulkSnapshots.usaAdsShopee,
                            onToggle: () => toggleBulkColuna("usaAdsShopee"),
                          })
                        ),
                        c(
                          "th",
                          {
                            key: "th-afiliado-shopee",
                            className: "px-3 py-3 text-center",
                            title:
                              "Considera comissão de afiliados no cálculo da margem deste produto",
                          },
                          c(CabecalhoComBulk, {
                            label: "Afiliado Shopee",
                            mostrarToggle: aba === "shopee",
                            ativo: !!bulkSnapshots.usaAfiliadoShopee,
                            onToggle: () =>
                              toggleBulkColuna("usaAfiliadoShopee"),
                          })
                        ),
                        c(
                          "th",
                          {
                            key: "th-lucro-shopee",
                            className: "px-3 py-3 text-right",
                          },
                          "Lucro Shopee (R$)"
                        ),
                        c(
                          "th",
                          {
                            key: "th-margem-shopee",
                            className: "px-3 py-3 text-right",
                          },
                          "Margem Shopee"
                        ),
                      ]
                    : []),
                  c("th", { className: "px-3 py-3" }, "")
                )
              ),
              c(
                "tbody",
                { className: "divide-y divide-gray-100" },
                produtosVisiveis.map((produto) =>
                  c(ProdutoRow, {
                    key: produto.id,
                    produto,
                    aba,
                    mostrarML,
                    mostrarShopee,
                    somenteLeitura,
                    colSpanDetalhes,
                    onChangeLocal: (patch: Partial<ProdutoPrecificacao>) =>
                      updateProdutoLocal(produto.id, patch),
                    onSalvar: () =>
                      salvarProduto(
                        produtosRef.current.find((p) => p.id === produto.id)!
                      ),
                  })
                )
              )
            )
          )
    )
  );
}

// 14/09/2026 -- cabeçalho de coluna com o checkbox opcional de
// "marcar todos" embaixo do rótulo. Só aparece na aba da plataforma
// dona da coluna (mostrarToggle) -- na aba Todos (somente leitura)
// nunca aparece, porque lá não dá pra editar nada.
function CabecalhoComBulk({
  label,
  mostrarToggle,
  ativo,
  onToggle,
}: {
  label: string;
  mostrarToggle: boolean;
  ativo: boolean;
  onToggle: () => void;
}) {
  return c(
    "div",
    { className: "flex flex-col items-center gap-1" },
    c("span", null, label),
    mostrarToggle
      ? c("input", {
          type: "checkbox",
          checked: ativo,
          onChange: onToggle,
          className: "h-3.5 w-3.5 cursor-pointer normal-case",
          title: ativo
            ? "Restaurar valor individual de cada produto"
            : "Marcar todos os produtos visíveis nesta coluna",
        })
      : null
  );
}

function ProdutoRow({
  produto,
  aba,
  mostrarML,
  mostrarShopee,
  somenteLeitura,
  colSpanDetalhes,
  onChangeLocal,
  onSalvar,
}: {
  produto: ProdutoPrecificacao;
  aba: AbaPlataforma;
  mostrarML: boolean;
  mostrarShopee: boolean;
  somenteLeitura: boolean;
  colSpanDetalhes: number;
  onChangeLocal: (patch: Partial<ProdutoPrecificacao>) => void;
  onSalvar: () => void;
}) {
  const [expandido, setExpandido] = useState(false);

  const margemClasse = (margemPct: number | undefined) => {
    if (margemPct == null) return "text-gray-400";
    if (margemPct < 10) return "text-red-600 font-semibold";
    if (margemPct < 20) return "text-amber-600 font-semibold";
    return "text-green-600 font-semibold";
  };

  // 06/09/2026 -- linha fica esmaecida quando o produto esta inativo
  // no contexto da aba atual (nao vendido nessa plataforma). Na aba
  // Todos, so esmaece se estiver inativo nas duas ao mesmo tempo.
  const inativoNoContexto =
    aba === "ml"
      ? !produto.ativoML
      : aba === "shopee"
      ? !produto.ativoShopee
      : !produto.ativoML && !produto.ativoShopee;

  function toggleAtivo(plataforma: "ml" | "shopee") {
    if (plataforma === "ml") {
      onChangeLocal({ ativoML: !produto.ativoML });
    } else {
      onChangeLocal({ ativoShopee: !produto.ativoShopee });
    }
    setTimeout(onSalvar, 0);
  }

  // 08/09/2026 -- Ads e Afiliado sao mutuamente exclusivos por
  // plataforma, igual o padrao ja usado na calculadora publica
  // (/painel, /mercadolivrecalculadora, /shopeecalculadora): marcar um
  // desmarca o outro. Nao e uma trava tecnica (o motor de calculo
  // aceita os dois juntos), e uma decisao de negocio -- na pratica o
  // Guilherme nao roda Ads e paga Afiliado no mesmo anuncio ao mesmo
  // tempo.
  function toggleAdsML(checked: boolean) {
    onChangeLocal(
      checked ? { usaAdsML: true, usaAfiliadoML: false } : { usaAdsML: false }
    );
    setTimeout(onSalvar, 0);
  }
  function toggleAfiliadoML(checked: boolean) {
    onChangeLocal(
      checked
        ? { usaAfiliadoML: true, usaAdsML: false }
        : { usaAfiliadoML: false }
    );
    setTimeout(onSalvar, 0);
  }
  function toggleAdsShopee(checked: boolean) {
    onChangeLocal(
      checked
        ? { usaAdsShopee: true, usaAfiliadoShopee: false }
        : { usaAdsShopee: false }
    );
    setTimeout(onSalvar, 0);
  }
  function toggleAfiliadoShopee(checked: boolean) {
    onChangeLocal(
      checked
        ? { usaAfiliadoShopee: true, usaAdsShopee: false }
        : { usaAfiliadoShopee: false }
    );
    setTimeout(onSalvar, 0);
  }

  const sufixoPlataforma = mostrarML && mostrarShopee;

  // 14/09/2026 -- classe extra pros inputs/checkboxes quando a linha
  // está em modo somente-leitura (aba Todos), pra ficar visualmente
  // claro que aquele campo não é editável ali.
  const classeInputBase =
    "w-28 rounded border border-gray-200 px-2 py-1 text-right text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400";
  const classeCheckboxBase =
    "h-4 w-4 disabled:cursor-not-allowed disabled:opacity-40";

  return c(
    React.Fragment,
    null,
    c(
      "tr",
      {
        className:
          "hover:bg-gray-50" + (inativoNoContexto ? " opacity-50" : ""),
      },
      c(
        "td",
        { className: "px-3 py-2" },
        c(
          "div",
          { className: "font-medium text-gray-900" },
          produto.nome
        ),
        c(
          "div",
          { className: "text-xs text-gray-400" },
          produto.sku || "—"
        )
      ),
      c(
        "td",
        { className: "px-3 py-2 text-right" },
        c("input", {
          type: "number",
          step: 0.01,
          min: 0,
          value: produto.pesoEnvioKg,
          disabled: somenteLeitura,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChangeLocal({ pesoEnvioKg: parseFloat(e.target.value) || 0 }),
          onBlur: onSalvar,
          className: classeInputBase,
        })
      ),
      c(
        "td",
        { className: "px-3 py-2 text-right" },
        c("input", {
          type: "number",
          step: 0.01,
          min: 0,
          value: produto.custoProducao,
          disabled: somenteLeitura,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChangeLocal({ custoProducao: parseFloat(e.target.value) || 0 }),
          onBlur: onSalvar,
          className: classeInputBase,
        }),
        produto.custoProducao !== produto.custoProducaoCalculado
          ? c(
              "div",
              { className: "mt-0.5 text-[10px] text-gray-400" },
              `calculado: ${formatBRL(produto.custoProducaoCalculado)}`
            )
          : null
      ),
      c(
        "td",
        { className: "px-3 py-2 text-right" },
        c("input", {
          type: "number",
          step: 0.05,
          min: 0,
          value: produto.embalagemCusto,
          disabled: somenteLeitura,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChangeLocal({ embalagemCusto: parseFloat(e.target.value) || 0 }),
          onBlur: onSalvar,
          className: classeInputBase,
        })
      ),
      ...(mostrarML
        ? [
            c(
              "td",
              { key: "td-preco-ml", className: "px-3 py-2 text-right" },
              c("input", {
                type: "number",
                step: 0.01,
                min: 0,
                value: produto.precoVendaML ?? "",
                placeholder: "—",
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  onChangeLocal({
                    precoVendaML: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  }),
                onBlur: onSalvar,
                className:
                  "w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400",
              })
            ),
            c(
              "td",
              { key: "td-ads-ml", className: "px-3 py-2 text-center" },
              c("input", {
                type: "checkbox",
                checked: produto.usaAdsML,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  toggleAdsML(e.target.checked),
                className: classeCheckboxBase,
                title: "Usa Ads (Mercado Ads) neste produto",
              })
            ),
            c(
              "td",
              { key: "td-afiliado-ml", className: "px-3 py-2 text-center" },
              c("input", {
                type: "checkbox",
                checked: produto.usaAfiliadoML,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  toggleAfiliadoML(e.target.checked),
                className: classeCheckboxBase,
                title: "Usa Afiliado/Parceiros neste produto",
              })
            ),
            c(
              "td",
              { key: "td-flex", className: "px-3 py-2 text-center" },
              c("input", {
                type: "checkbox",
                checked: produto.enviadoPorFlexML,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  onChangeLocal({ enviadoPorFlexML: e.target.checked });
                  setTimeout(onSalvar, 0);
                },
                className: classeCheckboxBase,
                title: "Enviado por Mercado Envios Flex",
              })
            ),
            c(
              "td",
              { key: "td-reembolso-flex", className: "px-3 py-2 text-right" },
              c("input", {
                type: "number",
                step: 0.1,
                min: 0,
                value: produto.reembolsoFlexML,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  onChangeLocal({
                    reembolsoFlexML: parseFloat(e.target.value) || 0,
                  }),
                onBlur: onSalvar,
                className: classeInputBase,
              })
            ),
            c(
              "td",
              {
                key: "td-lucro-ml",
                className: "px-3 py-2 text-right text-gray-700",
              },
              produto.resultadoML ? formatBRL(produto.resultadoML.lucro) : "—"
            ),
            c(
              "td",
              {
                key: "td-margem-ml",
                className: `px-3 py-2 text-right ${margemClasse(
                  produto.resultadoML?.margemPct
                )}`,
              },
              produto.resultadoML
                ? `${produto.resultadoML.margemPct.toFixed(1)}%`
                : "—"
            ),
          ]
        : []),
      ...(mostrarShopee
        ? [
            c(
              "td",
              { key: "td-preco-shopee", className: "px-3 py-2 text-right" },
              c("input", {
                type: "number",
                step: 0.01,
                min: 0,
                value: produto.precoVendaShopee ?? "",
                placeholder: "—",
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  onChangeLocal({
                    precoVendaShopee: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  }),
                onBlur: onSalvar,
                className:
                  "w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400",
              })
            ),
            c(
              "td",
              { key: "td-ads-shopee", className: "px-3 py-2 text-center" },
              c("input", {
                type: "checkbox",
                checked: produto.usaAdsShopee,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  toggleAdsShopee(e.target.checked),
                className: classeCheckboxBase,
                title: "Usa Ads (Shopee Ads) neste produto",
              })
            ),
            c(
              "td",
              {
                key: "td-afiliado-shopee",
                className: "px-3 py-2 text-center",
              },
              c("input", {
                type: "checkbox",
                checked: produto.usaAfiliadoShopee,
                disabled: somenteLeitura,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  toggleAfiliadoShopee(e.target.checked),
                className: classeCheckboxBase,
                title: "Usa Afiliado neste produto",
              })
            ),
            c(
              "td",
              {
                key: "td-lucro-shopee",
                className: "px-3 py-2 text-right text-gray-700",
              },
              produto.resultadoShopee
                ? formatBRL(produto.resultadoShopee.lucro)
                : "—"
            ),
            c(
              "td",
              {
                key: "td-margem-shopee",
                className: `px-3 py-2 text-right ${margemClasse(
                  produto.resultadoShopee?.margemPct
                )}`,
              },
              produto.resultadoShopee
                ? `${produto.resultadoShopee.margemPct.toFixed(1)}%`
                : "—"
            ),
          ]
        : []),
      c(
        "td",
        { className: "px-3 py-2 text-right" },
        c(
          "div",
          {
            className:
              "flex items-center justify-end gap-2 whitespace-nowrap",
          },
          // 14/09/2026 -- Inativar/Reativar muda dado (ativoML /
          // ativoShopee), então some na aba Todos (somente leitura) --
          // essas ações só fazem sentido a partir da aba da própria
          // plataforma.
          mostrarML && !somenteLeitura
            ? c(
                "button",
                {
                  key: "toggle-ml",
                  type: "button",
                  onClick: () => toggleAtivo("ml"),
                  className: produto.ativoML
                    ? "text-xs text-gray-400 hover:text-red-600"
                    : "text-xs font-medium text-amber-600 hover:text-green-600",
                  title: produto.ativoML
                    ? "Marcar que este produto não é vendido no Mercado Livre"
                    : "Reativar este produto no Mercado Livre",
                },
                produto.ativoML
                  ? sufixoPlataforma
                    ? "Inativar ML"
                    : "Inativar"
                  : sufixoPlataforma
                  ? "Reativar ML"
                  : "Reativar"
              )
            : null,
          mostrarShopee && !somenteLeitura
            ? c(
                "button",
                {
                  key: "toggle-shopee",
                  type: "button",
                  onClick: () => toggleAtivo("shopee"),
                  className: produto.ativoShopee
                    ? "text-xs text-gray-400 hover:text-red-600"
                    : "text-xs font-medium text-amber-600 hover:text-green-600",
                  title: produto.ativoShopee
                    ? "Marcar que este produto não é vendido na Shopee"
                    : "Reativar este produto na Shopee",
                },
                produto.ativoShopee
                  ? sufixoPlataforma
                    ? "Inativar Shopee"
                    : "Inativar"
                  : sufixoPlataforma
                  ? "Reativar Shopee"
                  : "Reativar"
              )
            : null,
          c(
            "button",
            {
              key: "btn-detalhes",
              type: "button",
              onClick: () => setExpandido((v) => !v),
              className: "text-xs text-blue-600 hover:underline",
            },
            expandido ? "Ocultar" : "Detalhes"
          )
        )
      )
    ),
    expandido
      ? c(
          "tr",
          { className: "bg-gray-50" },
          c(
            "td",
            { colSpan: colSpanDetalhes, className: "px-3 py-3" },
            c(
              "div",
              {
                className:
                  "grid grid-cols-1 gap-4 " +
                  (mostrarML && mostrarShopee ? "sm:grid-cols-2" : ""),
              },
              mostrarML
                ? c(DetalhePlataforma, {
                    titulo: "Mercado Livre",
                    resultado: produto.resultadoML,
                  })
                : null,
              mostrarShopee
                ? c(DetalhePlataforma, {
                    titulo: "Shopee",
                    resultado: produto.resultadoShopee,
                  })
                : null
            )
          )
        )
      : null
  );
}

function DetalhePlataforma({
  titulo,
  resultado,
}: {
  titulo: string;
  resultado: ResultadoPlataforma | null;
}) {
  if (!resultado) {
    return c(
      "div",
      { className: "rounded-md border border-gray-200 bg-white p-3" },
      c(
        "div",
        { className: "mb-1 text-xs font-semibold text-gray-700" },
        titulo
      ),
      c(
        "div",
        { className: "text-xs text-gray-400" },
        "Defina um preço de venda para ver o detalhamento."
      )
    );
  }
  const linhas: [string, number][] = [
    ["Preço de venda", resultado.preco],
    ["Comissão", -resultado.comissao],
    ["Tarifa", -resultado.taxaFixa],
    ["Imposto", -resultado.imposto],
    ["ADS", -resultado.ads],
  ];
  if (resultado.afiliado) linhas.push(["Afiliado", -resultado.afiliado]);
  linhas.push(["Embalagem", -resultado.embalagem]);
  if (resultado.flexCusto) linhas.push(["Custo Flex", -resultado.flexCusto]);
  linhas.push(["Custo de produção", -resultado.custoProducao]);
  return c(
    "div",
    { className: "rounded-md border border-gray-200 bg-white p-3" },
    c(
      "div",
      { className: "mb-2 text-xs font-semibold text-gray-700" },
      titulo
    ),
    c(
      "div",
      { className: "flex flex-col gap-1" },
      linhas.map(([label, valor]) =>
        c(
          "div",
          {
            key: label,
            className:
              "flex items-center justify-between text-xs text-gray-600",
          },
          c("span", null, label),
          c(
            "span",
            { className: valor < 0 ? "text-red-600" : "text-gray-700" },
            formatBRL(valor)
          )
        )
      ),
      c(
        "div",
        {
          className:
            "mt-1 flex items-center justify-between border-t border-gray-200 pt-1 text-xs font-semibold",
        },
        c("span", null, "Lucro"),
        c(
          "span",
          {
            className:
              resultado.lucro < 0 ? "text-red-600" : "text-green-600",
          },
          formatBRL(resultado.lucro)
        )
      )
    )
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  pendente,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  pendente?: boolean;
}) {
  return c(
    "label",
    { className: "block" },
    c(
      "span",
      { className: "mb-1 block text-xs font-medium text-gray-600" },
      label,
      pendente
        ? c(
            "span",
            {
              className:
                "ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700",
            },
            "confirmar"
          )
        : null
    ),
    c("input", {
      type: "number",
      value: Number.isFinite(value) ? value : 0,
      step,
      min: 0,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        onChange(parseFloat(e.target.value) || 0),
      className:
        "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
    })
  );
}
