"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatBRL } from "@/lib/precificacao";
import {
  ConfigTikTok,
  DEFAULT_CONFIG_TIKTOK,
  calcularTikTok,
  precoParaMargemTikTok,
} from "@/lib/precificacao-tiktok";

const c = React.createElement;

// Subconjunto dos campos de /api/precificacao/produtos que a aba TikTok usa.
export interface ProdutoTikTokBase {
  id: number;
  nome: string;
  sku: string;
  custoProducao: number;
  embalagemCusto: number;
  precoVendaML: number | null;
  precoAnunciadoML: number | null;
}

interface ItemTikTok {
  sku: string;
  precoVenda: number | null;
  ativo: boolean;
  usaAds: boolean;
  usaAfiliado: boolean;
  usaFrete: boolean;
}

function chaveSku(p: ProdutoTikTokBase): string {
  return (p.sku && p.sku.trim()) || p.nome;
}

function itemPadrao(sku: string): ItemTikTok {
  return {
    sku,
    precoVenda: null,
    ativo: true,
    usaAds: false,
    usaAfiliado: false,
    usaFrete: false,
  };
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}

function margemClasse(m: number | undefined): string {
  if (m == null) return "text-gray-400";
  if (m < 10) return "text-red-600 font-semibold";
  if (m < 20) return "text-amber-600 font-semibold";
  return "text-green-600 font-semibold";
}

export default function PrecificacaoTikTok({
  produtos,
  impostoPct,
  margemPadraoPct,
  busca,
  mostrarInativos,
}: {
  produtos: ProdutoTikTokBase[];
  impostoPct: number;
  margemPadraoPct: number;
  busca: string;
  mostrarInativos: boolean;
}) {
  const [config, setConfig] = useState<ConfigTikTok>(DEFAULT_CONFIG_TIKTOK);
  const [configSalva, setConfigSalva] = useState(true);
  const [itens, setItens] = useState<Record<string, ItemTikTok>>({});
  const [carregando, setCarregando] = useState(true);
  const [margemAlvo, setMargemAlvo] = useState<number>(margemPadraoPct || 20);
  const [expandido, setExpandido] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/precificacao/tiktok")
      .then((r) => r.json())
      .then((data: { config: ConfigTikTok; itens: ItemTikTok[] }) => {
        if (!vivo) return;
        setConfig(data.config);
        const mapa: Record<string, ItemTikTok> = {};
        for (const it of data.itens) mapa[it.sku] = it;
        setItens(mapa);
        setCarregando(false);
      })
      .catch(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  function itemDe(p: ProdutoTikTokBase): ItemTikTok {
    const k = chaveSku(p);
    return itens[k] ?? itemPadrao(k);
  }

  async function salvarItem(item: ItemTikTok) {
    await fetch("/api/precificacao/tiktok", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
  }

  // Atualiza na tela e, quando `salvar` e true, grava no banco (usado nos
  // checkboxes/botoes; o campo de preco grava no onBlur).
  function atualizar(p: ProdutoTikTokBase, patch: Partial<ItemTikTok>, salvar: boolean) {
    const k = chaveSku(p);
    const novo: ItemTikTok = { ...(itens[k] ?? itemPadrao(k)), ...patch };
    setItens((prev) => ({ ...prev, [k]: novo }));
    if (salvar) void salvarItem(novo);
  }

  function gravarAtual(p: ProdutoTikTokBase) {
    void salvarItem(itemDe(p));
  }

  function updateConfig<K extends keyof ConfigTikTok>(key: K, value: number) {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setConfigSalva(false);
  }

  async function salvarConfig() {
    await fetch("/api/precificacao/tiktok", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    setConfigSalva(true);
  }

  const linhas = useMemo(() => {
    const alvo = normalizar(busca);
    return produtos.filter((p) => {
      if (alvo && !normalizar(p.nome).includes(alvo) && !normalizar(p.sku).includes(alvo)) {
        return false;
      }
      if (mostrarInativos) return true;
      const it = itens[chaveSku(p)];
      return it ? it.ativo : true;
    });
  }, [produtos, busca, mostrarInativos, itens]);

  if (carregando) {
    return c(
      "div",
      { className: "rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500" },
      "Carregando TikTok Shop..."
    );
  }

  const campoConfig = (
    label: string,
    valor: number,
    onChange: (v: number) => void,
    step: number,
    pendente?: boolean
  ) =>
    c(
      "label",
      { className: "block", key: label },
      c(
        "span",
        { className: "mb-1 block text-xs font-medium text-gray-600" },
        label,
        pendente
          ? c(
              "span",
              { className: "ml-1 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700" },
              "confirmar"
            )
          : null
      ),
      c("input", {
        type: "number",
        value: Number.isFinite(valor) ? valor : 0,
        step,
        min: 0,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(parseFloat(e.target.value) || 0),
        className:
          "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
      })
    );

  const th = (texto: string, extra?: string, title?: string) =>
    c("th", { key: texto, className: "px-3 py-3 " + (extra ?? "text-right"), title }, texto);

  const check = (marcado: boolean, onChange: (v: boolean) => void, title: string) =>
    c("input", {
      type: "checkbox",
      checked: marcado,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.checked),
      className: "h-4 w-4",
      title,
    });

  const linhasTabela: React.ReactNode[] = [];
  for (const p of linhas) {
    const k = chaveSku(p);
    const it = itemDe(p);
    const res =
      it.precoVenda != null && it.precoVenda > 0
        ? calcularTikTok(
            it.precoVenda,
            p.custoProducao,
            p.embalagemCusto,
            impostoPct,
            config,
            it.usaAds,
            it.usaAfiliado,
            it.usaFrete
          )
        : null;
    const sugerido = precoParaMargemTikTok(
      margemAlvo,
      p.custoProducao,
      p.embalagemCusto,
      impostoPct,
      config,
      it.usaAds,
      it.usaAfiliado,
      it.usaFrete
    );
    const refML = p.precoAnunciadoML ?? p.precoVendaML;

    linhasTabela.push(
      c(
        "tr",
        { key: k, className: "hover:bg-gray-50 " + (it.ativo ? "" : "opacity-50") },
        c(
          "td",
          { className: "sticky left-0 z-10 bg-white px-3 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]" },
          c("div", { className: "font-medium text-gray-900" }, p.nome),
          c("div", { className: "text-xs text-gray-400" }, p.sku || "\u2014")
        ),
        c("td", { className: "px-3 py-2 text-right text-gray-700" }, formatBRL(p.custoProducao)),
        c("td", { className: "px-3 py-2 text-right text-gray-700" }, formatBRL(p.embalagemCusto)),
        c(
          "td",
          { className: "px-3 py-2 text-right text-gray-500" },
          refML != null ? formatBRL(refML) : "\u2014",
          refML != null
            ? c(
                "button",
                {
                  type: "button",
                  onClick: () => atualizar(p, { precoVenda: refML }, true),
                  className: "ml-2 text-xs text-blue-600 hover:underline",
                  title: "Usar este valor como pre\u00e7o no TikTok",
                },
                "usar"
              )
            : null
        ),
        c(
          "td",
          { className: "px-3 py-2 text-right" },
          c("input", {
            type: "number",
            step: 0.01,
            min: 0,
            value: it.precoVenda ?? "",
            placeholder: "\u2014",
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              atualizar(p, { precoVenda: e.target.value ? parseFloat(e.target.value) : null }, false),
            onBlur: () => gravarAtual(p),
            className: "w-24 rounded border border-gray-200 px-2 py-1 text-right text-sm",
          })
        ),
        c("td", { className: "px-3 py-2 text-center" }, check(it.usaAds, (v) => atualizar(p, { usaAds: v, usaAfiliado: v ? false : it.usaAfiliado }, true), "Considera o custo de Ads (TikTok Ads) neste produto")),
        c("td", { className: "px-3 py-2 text-center" }, check(it.usaAfiliado, (v) => atualizar(p, { usaAfiliado: v, usaAds: v ? false : it.usaAds }, true), "Considera a comiss\u00e3o de afiliado (criador) neste produto")),
        c("td", { className: "px-3 py-2 text-center" }, check(it.usaFrete, (v) => atualizar(p, { usaFrete: v }, true), "Produto est\u00e1 no Programa de Frete Gr\u00e1tis")),
        c(
          "td",
          { className: "px-3 py-2 text-right text-gray-700" },
          res ? res.comissaoPct + "% = " + formatBRL(res.comissao) : "\u2014"
        ),
        c("td", { className: "px-3 py-2 text-right text-gray-700" }, res ? formatBRL(res.taxaFixa) : "\u2014"),
        c("td", { className: "px-3 py-2 text-right text-gray-700" }, res ? formatBRL(res.lucro) : "\u2014"),
        c(
          "td",
          { className: "px-3 py-2 text-right " + margemClasse(res?.margemPct) },
          res ? res.margemPct.toFixed(1) + "%" : "\u2014"
        ),
        c(
          "td",
          { className: "px-3 py-2 text-right text-gray-700" },
          sugerido != null ? formatBRL(sugerido) : "\u2014",
          sugerido != null
            ? c(
                "button",
                {
                  type: "button",
                  onClick: () => atualizar(p, { precoVenda: sugerido }, true),
                  className: "ml-2 text-xs text-blue-600 hover:underline",
                  title: "Usar o pre\u00e7o sugerido",
                },
                "usar"
              )
            : null
        ),
        c(
          "td",
          { className: "whitespace-nowrap px-3 py-2 text-right" },
          c(
            "button",
            {
              type: "button",
              onClick: () => setExpandido(expandido === k ? null : k),
              className: "mr-3 text-xs text-blue-600 hover:underline",
            },
            expandido === k ? "Ocultar" : "Detalhes"
          ),
          c(
            "button",
            {
              type: "button",
              onClick: () => atualizar(p, { ativo: !it.ativo }, true),
              className: "text-xs text-gray-500 hover:underline",
            },
            it.ativo ? "Inativar" : "Reativar"
          )
        )
      )
    );

    if (expandido === k) {
      const linhasDetalhe: [string, number][] = res
        ? [
            ["Pre\u00e7o de venda", res.preco],
            ["Comiss\u00e3o (" + res.comissaoPct + "%)", -res.comissao],
            ["Taxa por item vendido", -res.taxaFixa],
            ["Imposto", -res.imposto],
          ]
        : [];
      if (res) {
        if (res.ads) linhasDetalhe.push(["ADS", -res.ads]);
        if (res.afiliado) linhasDetalhe.push(["Afiliado", -res.afiliado]);
        if (res.frete) linhasDetalhe.push(["Programa de Frete Gr\u00e1tis", -res.frete]);
        linhasDetalhe.push(["Embalagem", -res.embalagem]);
        linhasDetalhe.push(["Custo de produ\u00e7\u00e3o", -res.custoProducao]);
      }
      linhasTabela.push(
        c(
          "tr",
          { key: k + "-det", className: "bg-gray-50" },
          c(
            "td",
            { colSpan: 14, className: "px-3 py-3" },
            res
              ? c(
                  "div",
                  { className: "max-w-sm rounded-md border border-gray-200 bg-white p-3" },
                  c("div", { className: "mb-2 text-xs font-semibold text-gray-700" }, "TikTok Shop"),
                  c(
                    "div",
                    { className: "flex flex-col gap-1" },
                    linhasDetalhe.map(([label, valor]) =>
                      c(
                        "div",
                        { key: label, className: "flex items-center justify-between text-xs text-gray-600" },
                        c("span", null, label),
                        c("span", { className: valor < 0 ? "text-red-600" : "text-gray-700" }, formatBRL(valor))
                      )
                    ),
                    c(
                      "div",
                      { className: "mt-1 flex items-center justify-between border-t border-gray-200 pt-1 text-xs font-semibold" },
                      c("span", null, "Lucro"),
                      c("span", { className: res.lucro < 0 ? "text-red-600" : "text-green-600" }, formatBRL(res.lucro))
                    )
                  )
                )
              : c("div", { className: "text-xs text-gray-400" }, "Defina um pre\u00e7o de venda no TikTok para ver o detalhamento.")
          )
        )
      );
    }
  }

  return c(
    "div",
    { className: "flex flex-col gap-4" },
    c(
      "div",
      { className: "rounded-lg border border-gray-200 bg-white p-5" },
      c(
        "div",
        { className: "mb-3 flex items-center justify-between" },
        c("h3", { className: "text-sm font-semibold text-gray-900" }, "Configura\u00e7\u00e3o TikTok Shop"),
        c(
          "div",
          { className: "flex items-center gap-2" },
          configSalva
            ? c("span", { className: "text-xs text-gray-400" }, "Salvo")
            : c("span", { className: "text-xs text-amber-600" }, "Altera\u00e7\u00f5es n\u00e3o salvas"),
          c(
            "button",
            {
              type: "button",
              onClick: salvarConfig,
              disabled: configSalva,
              className: "rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40",
            },
            "Salvar configura\u00e7\u00e3o"
          )
        )
      ),
      c(
        "p",
        { className: "mb-4 rounded-md bg-blue-50 p-3 text-xs text-blue-900" },
        "Tarifas oficiais da Central do Vendedor TikTok Shop (vigentes desde 15/07/2026, conferidas em 28/10/2026): item abaixo de R$ 50,00 paga comiss\u00e3o de 10% + R$ 4,00 por item vendido; de R$ 50,00 para cima, comiss\u00e3o de 6% + R$ 6,00 por item. A base \u00e9 o pre\u00e7o ap\u00f3s descontos do vendedor (desconto bancado pelo TikTok n\u00e3o entra). Essas faixas j\u00e1 est\u00e3o fixas no c\u00e1lculo. O Programa de Frete Gr\u00e1tis soma uma taxa de servi\u00e7o (cerca de 6% do pre\u00e7o, teto de R$ 50 por item) \u00e0 comiss\u00e3o \u2014 percentual e teto vieram de fontes secund\u00e1rias, confira numa demonstra\u00e7\u00e3o financeira de pedido entregue (Central do Vendedor > Finan\u00e7as). Ads e Afiliado s\u00e3o mutuamente exclusivos por produto, igual \u00e0s outras plataformas; o % \u00e9 o valor usado quando o check est\u00e1 marcado. O imposto usa o mesmo % da configura\u00e7\u00e3o geral acima. A coluna \"Ref. ML\" mostra o pre\u00e7o cheio do an\u00fancio no Mercado Livre (bot\u00e3o \"usar\" copia pro TikTok) e \"Pre\u00e7o sugerido\" calcula o menor pre\u00e7o que atinge a margem alvo abaixo."
      ),
      c(
        "div",
        { className: "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" },
        campoConfig("ADS TikTok (%)", config.adsPct, (v) => updateConfig("adsPct", v), 0.5, true),
        campoConfig("Afiliado TikTok (%)", config.afiliadoPct, (v) => updateConfig("afiliadoPct", v), 0.5, true),
        campoConfig("Frete Gr\u00e1tis (%)", config.fretePct, (v) => updateConfig("fretePct", v), 0.5, true),
        campoConfig("Frete Gr\u00e1tis teto (R$)", config.freteTeto, (v) => updateConfig("freteTeto", v), 1, true),
        c(
          "label",
          { className: "block", key: "margem-alvo" },
          c("span", { className: "mb-1 block text-xs font-medium text-gray-600" }, "Margem alvo (%) p/ pre\u00e7o sugerido"),
          c("input", {
            type: "number",
            value: Number.isFinite(margemAlvo) ? margemAlvo : 0,
            step: 1,
            min: 0,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setMargemAlvo(parseFloat(e.target.value) || 0),
            className:
              "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
          })
        )
      )
    ),
    linhas.length === 0
      ? c(
          "div",
          { className: "rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500" },
          "Nenhum produto encontrado com esse filtro."
        )
      : c(
          "div",
          { className: "overflow-x-auto overflow-y-auto max-h-[75vh] rounded-lg border border-gray-200 bg-white" },
          c(
            "table",
            { className: "min-w-full divide-y divide-gray-200 text-sm" },
            c(
              "thead",
              { className: "sticky top-0 z-20 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500" },
              c(
                "tr",
                null,
                c("th", { key: "p", className: "sticky left-0 z-30 bg-gray-50 px-3 py-3 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]" }, "Produto"),
                th("Custo produ\u00e7\u00e3o"),
                th("Embalagem"),
                th("Ref. ML", "text-right", "Pre\u00e7o cheio do an\u00fancio no Mercado Livre (ou o praticado, se n\u00e3o houver)"),
                th("Pre\u00e7o TikTok"),
                th("Ads", "text-center", "Usa Ads (TikTok Ads) neste produto"),
                th("Afiliado", "text-center", "Usa comiss\u00e3o de afiliado neste produto"),
                th("Frete gr\u00e1tis", "text-center", "Participa do Programa de Frete Gr\u00e1tis"),
                th("Comiss\u00e3o"),
                th("Taxa/item"),
                th("Lucro (R$)"),
                th("Margem"),
                th("Pre\u00e7o sugerido", "text-right", "Menor pre\u00e7o que atinge a margem alvo com os checks atuais"),
                c("th", { key: "acoes", className: "px-3 py-3" }, "")
              )
            ),
            c("tbody", { className: "divide-y divide-gray-100" }, linhasTabela)
          )
        )
  );
}
