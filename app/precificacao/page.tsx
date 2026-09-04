"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  pesoEnvioKg: number;
  embalagemCusto: number;
  margemDesejadaPct: number;
  precoVendaML: number | null;
  precoVendaShopee: number | null;
  enviadoPorFlexML: boolean;
  resultadoML: ResultadoPlataforma | null;
  resultadoShopee: ResultadoPlataforma | null;
}

type AbaPlataforma = "todos" | "ml" | "shopee";

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

  async function salvarProduto(produto: ProdutoPrecificacao) {
    await fetch("/api/precificacao/produtos", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        produtoId: produto.id,
        pesoEnvioKg: produto.pesoEnvioKg,
        precoVendaML: produto.precoVendaML,
        precoVendaShopee: produto.precoVendaShopee,
        enviadoPorFlexML: produto.enviadoPorFlexML,
        embalagemCusto: produto.embalagemCusto,
        margemDesejadaPct: produto.margemDesejadaPct,
      }),
    });
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
  const colSpanDetalhes =
    3 + (mostrarML ? 4 : 0) + (mostrarShopee ? 3 : 0) + 1;

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
        "Comissão ML (11,5% Clássico), tarifa por peso do ML e comissão + tarifa fixa da Shopee já vêm calibradas com dados reais verificados em 19/08/2026 — não precisam de ajuste manual. Embalagem agora é configurada por produto, direto na tabela abaixo. Margem ML/Shopee mostra a margem real, calculada a partir do preço de venda que você preencher em cada produto. Imposto, ADS e afiliado Shopee continuam editáveis aqui e ainda precisam de confirmação. Custo do Flex ML: você confirmou que o ML reembolsa parte do custo mas ainda há um custo real que você paga — o valor abaixo fica em R$0 até você levantar o número exato."
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
          label: "Reembolso Flex ML (R$)",
          value: config.reembolsoFlexML,
          onChange: (v: number) => updateConfig("reembolsoFlexML", v),
          step: 0.1,
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
            produtosFiltrados.length,
            busca.trim() ? ` de ${produtos.length}` : "",
            ")"
          )
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
      produtosFiltrados.length === 0
        ? c(
            "div",
            {
              className:
                "rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500",
            },
            "Nenhum produto encontrado. Cadastre produtos na aba Custo primeiro."
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
                    { className: "px-3 py-3 text-right" },
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
                          { key: "th-preco-ml", className: "px-3 py-3 text-right" },
                          "Preço ML"
                        ),
                        c(
                          "th",
                          { key: "th-flex", className: "px-3 py-3 text-center" },
                          "Flex"
                        ),
                        c(
                          "th",
                          { key: "th-lucro-ml", className: "px-3 py-3 text-right" },
                          "Lucro ML (R$)"
                        ),
                        c(
                          "th",
                          { key: "th-margem-ml", className: "px-3 py-3 text-right" },
                          "Margem ML"
                        ),
                      ]
                    : []),
                  ...(mostrarShopee
                    ? [
                        c(
                          "th",
                          { key: "th-preco-shopee", className: "px-3 py-3 text-right" },
                          "Preço Shopee"
                        ),
                        c(
                          "th",
                          { key: "th-lucro-shopee", className: "px-3 py-3 text-right" },
                          "Lucro Shopee (R$)"
                        ),
                        c(
                          "th",
                          { key: "th-margem-shopee", className: "px-3 py-3 text-right" },
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
                produtosFiltrados.map((produto) =>
                  c(ProdutoRow, {
                    key: produto.id,
                    produto,
                    mostrarML,
                    mostrarShopee,
                    colSpanDetalhes,
                    onChangeLocal: (patch: Partial<ProdutoPrecificacao>) =>
                      updateProdutoLocal(produto.id, patch),
                    onSalvar: () =>
                      salvarProduto(
                        produtos.find((p) => p.id === produto.id)!
                      ),
                  })
                )
              )
            )
          )
    )
  );
}

function ProdutoRow({
  produto,
  mostrarML,
  mostrarShopee,
  colSpanDetalhes,
  onChangeLocal,
  onSalvar,
}: {
  produto: ProdutoPrecificacao;
  mostrarML: boolean;
  mostrarShopee: boolean;
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

  return c(
    React.Fragment,
    null,
    c(
      "tr",
      { className: "hover:bg-gray-50" },
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
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChangeLocal({ pesoEnvioKg: parseFloat(e.target.value) || 0 }),
          onBlur: onSalvar,
          className:
            "w-20 rounded border border-gray-200 px-2 py-1 text-right text-sm",
        })
      ),
      c(
        "td",
        { className: "px-3 py-2 text-right text-gray-700" },
        formatBRL(produto.custoProducao)
      ),
      c(
        "td",
        { className: "px-3 py-2 text-right" },
        c("input", {
          type: "number",
          step: 0.05,
          min: 0,
          value: produto.embalagemCusto,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChangeLocal({ embalagemCusto: parseFloat(e.target.value) || 0 }),
          onBlur: onSalvar,
          className:
            "w-20 rounded border border-gray-200 px-2 py-1 text-right text-sm",
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
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  onChangeLocal({
                    precoVendaML: e.target.value ? parseFloat(e.target.value) : null,
                  }),
                onBlur: onSalvar,
                className:
                  "w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm",
              })
            ),
            c(
              "td",
              { key: "td-flex", className: "px-3 py-2 text-center" },
              c("input", {
                type: "checkbox",
                checked: produto.enviadoPorFlexML,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  onChangeLocal({ enviadoPorFlexML: e.target.checked });
                  setTimeout(onSalvar, 0);
                },
                className: "h-4 w-4",
                title: "Enviado por Mercado Envios Flex",
              })
            ),
            c(
              "td",
              { key: "td-lucro-ml", className: "px-3 py-2 text-right text-gray-700" },
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
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  onChangeLocal({
                    precoVendaShopee: e.target.value
                      ? parseFloat(e.target.value)
                      : null,
                  }),
                onBlur: onSalvar,
                className:
                  "w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm",
              })
            ),
            c(
              "td",
              { key: "td-lucro-shopee", className: "px-3 py-2 text-right text-gray-700" },
              produto.resultadoShopee ? formatBRL(produto.resultadoShopee.lucro) : "—"
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
          "button",
          {
            type: "button",
            onClick: () => setExpandido((v) => !v),
            className: "text-xs text-blue-600 hover:underline",
          },
          expandido ? "Ocultar" : "Detalhes"
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
      c("div", { className: "mb-1 text-xs font-semibold text-gray-700" }, titulo),
      c("div", { className: "text-xs text-gray-400" }, "Defina um preço de venda para ver o detalhamento.")
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
    c("div", { className: "mb-2 text-xs font-semibold text-gray-700" }, titulo),
    c(
      "div",
      { className: "flex flex-col gap-1" },
      linhas.map(([label, valor]) =>
        c(
          "div",
          { key: label, className: "flex items-center justify-between text-xs text-gray-600" },
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
        { className: "mt-1 flex items-center justify-between border-t border-gray-200 pt-1 text-xs font-semibold" },
        c("span", null, "Lucro"),
        c(
          "span",
          { className: resultado.lucro < 0 ? "text-red-600" : "text-green-600" },
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
