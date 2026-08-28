"use client";

import { useEffect, useMemo, useState } from "react";

// Aba "Produtos" -- pedido do Guilherme em 2026-08-26: "vai ser onde
// vamos ter cadastrado todos os nossos produtos e como ele e composto".
// Le /api/produtos/catalogo, que junta sku_placa (SKU real de venda) com
// placas (catalogo de producao) -- cada linha da tabela abaixo e uma SKU
// ja cadastrada, mostrando de quais placas ela e composta (corpo,
// gancho, ou peca unica) e quantas pecas de cada uma saem por unidade
// vendida.
//
// Extensao de 2026-08-28 -- pedido do Guilherme: "Tela editavel na aba
// de produtos e mostrar nos produtos que vao mais de 1un a sku
// principal que ele vai e quanto ele consome dela". Duas mudancas:
// (1) a composicao de cada SKU agora e editavel direto na tela (criar
// SKU novo, adicionar/remover placas, mudar pecas por unidade), via
// /api/produtos/composicao; (2) quando um componente consome mais de 1
// peca da mesma placa, mostramos qual e o SKU "principal" (a versao de
// 1 unidade daquela mesma placa) e quantas pecas dele o kit consome --
// ex: um SKU "2 Porta Lapis Laranja" mostra que consome 2x a placa que
// tambem abastece o SKU de 1 unidade "1 Porta Lapis Laranja".

interface Componente {
  placaId: number;
  placaNumero: number;
  placaNome: string;
  papel: "corpo" | "gancho" | null;
  grupoComposto: string | null;
  pecasPorUnidade: number;
  tier: "A" | "B" | "C" | string;
  tipo: "direta" | "composto" | string;
  pesoPlacaGramas: number | null;
  tempoPlacaHoras: number;
  descontinuada: boolean;
  estoque: number;
  skuPrincipal: string | null;
}

interface ProdutoRow {
  sku: string;
  componentes: Componente[];
}

interface PlacaSemSku {
  placaId: number;
  placaNumero: number;
  placaNome: string;
  papel: string | null;
  grupoComposto: string | null;
  tier: string;
}

interface PlacaOpcao {
  id: number;
  numero: number;
  nome: string;
  papel: "corpo" | "gancho" | null;
  descontinuada: boolean;
}

type Status = "loading" | "ready" | "erro";

const LABEL_PAPEL: Record<string, string> = { corpo: "Corpo", gancho: "Gancho" };

function estoqueVendavelDoSku(componentes: Componente[]): number {
  if (componentes.length === 0) return 0;
  return Math.min(
    ...componentes.map((c) =>
      c.pecasPorUnidade > 0 ? Math.floor(c.estoque / c.pecasPorUnidade) : 0
    )
  );
}

// Linha de rascunho usada tanto no modo edicao de um SKU existente
// quanto no formulario de "novo produto" -- cada linha ainda nao salva
// vira uma chamada POST pra /api/produtos/composicao quando o usuario
// confirma. rotuloFallback guarda o nome da placa pro caso dela ja ter
// sido descontinuada (e por isso nao aparecer mais em /api/placas).
interface LinhaRascunho {
  chave: string;
  placaId: number | null;
  pecasPorUnidade: string;
  rotuloFallback?: string;
}

function novaLinhaRascunho(): LinhaRascunho {
  return { chave: Math.random().toString(36).slice(2), placaId: null, pecasPorUnidade: "1" };
}

function atualizarLinha(
  lista: LinhaRascunho[],
  chave: string,
  patch: Partial<LinhaRascunho>
): LinhaRascunho[] {
  return lista.map((l) => (l.chave === chave ? { ...l, ...patch } : l));
}

export default function ProdutosPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [produtos, setProdutos] = useState<ProdutoRow[]>([]);
  const [placasSemSku, setPlacasSemSku] = useState<PlacaSemSku[]>([]);
  const [placasOpcoes, setPlacasOpcoes] = useState<PlacaOpcao[]>([]);
  const [busca, setBusca] = useState("");
  const [mostrarDescontinuadas, setMostrarDescontinuadas] = useState(false);

  const [skuEmEdicao, setSkuEmEdicao] = useState<string | null>(null);
  const [linhasEdicao, setLinhasEdicao] = useState<LinhaRascunho[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  const [novoProdutoAberto, setNovoProdutoAberto] = useState(false);
  const [novoSku, setNovoSku] = useState("");
  const [linhasNovoProduto, setLinhasNovoProduto] = useState<LinhaRascunho[]>([
    novaLinhaRascunho(),
  ]);

  function carregar() {
    setStatus("loading");
    Promise.all([
      fetch("/api/produtos/catalogo").then((r) => r.json()),
      fetch("/api/placas").then((r) => r.json()),
    ])
      .then(([catalogo, placas]) => {
        setProdutos(catalogo.produtos ?? []);
        setPlacasSemSku(catalogo.placasSemSku ?? []);
        setPlacasOpcoes(
          (Array.isArray(placas) ? placas : []).map(
            (p: { id: number; numero: number; nome: string; papel: string | null; descontinuada: boolean }) => ({
              id: p.id,
              numero: p.numero,
              nome: p.nome,
              papel: (p.papel as "corpo" | "gancho" | null) ?? null,
              descontinuada: !!p.descontinuada,
            })
          )
        );
        setStatus("ready");
      })
      .catch(() => setStatus("erro"));
  }

  useEffect(() => {
    carregar();
  }, []);

  const produtosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos.filter((p) => {
      const temDescontinuada = p.componentes.some((c) => c.descontinuada);
      if (temDescontinuada && !mostrarDescontinuadas) return false;
      if (!termo) return true;
      if (p.sku.toLowerCase().includes(termo)) return true;
      return p.componentes.some((c) =>
        c.placaNome.toLowerCase().includes(termo)
      );
    });
  }, [produtos, busca, mostrarDescontinuadas]);

  function iniciarEdicao(p: ProdutoRow) {
    setErroSalvar(null);
    setNovoProdutoAberto(false);
    setSkuEmEdicao(p.sku);
    setLinhasEdicao(
      p.componentes.map((c) => ({
        chave: String(c.placaId),
        placaId: c.placaId,
        pecasPorUnidade: String(c.pecasPorUnidade),
        rotuloFallback: `#${c.placaNumero} ${c.placaNome}${
          c.papel ? ` (${LABEL_PAPEL[c.papel] ?? c.papel})` : ""
        }`,
      }))
    );
  }

  function cancelarEdicao() {
    setSkuEmEdicao(null);
    setLinhasEdicao([]);
    setErroSalvar(null);
  }

  async function salvarEdicao(skuOriginal: string) {
    setSalvando(true);
    setErroSalvar(null);
    try {
      const linhasValidas = linhasEdicao.filter((l) => l.placaId !== null);
      for (const linha of linhasValidas) {
        const pecas = Number(linha.pecasPorUnidade);
        if (!Number.isFinite(pecas) || pecas <= 0) {
          throw new Error(
            "Peças por unidade deve ser maior que zero em todas as linhas."
          );
        }
      }

      const produtoOriginal = produtos.find((p) => p.sku === skuOriginal);
      const placaIdsOriginais = new Set(
        (produtoOriginal?.componentes ?? []).map((c) => c.placaId)
      );
      const placaIdsAtuais = new Set(
        linhasValidas.map((l) => l.placaId as number)
      );

      // Remove linhas que existiam antes e foram tiradas do rascunho.
      for (const placaId of placaIdsOriginais) {
        if (!placaIdsAtuais.has(placaId)) {
          await fetch("/api/produtos/composicao", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sku: skuOriginal, placaId }),
          });
        }
      }

      // Cria/atualiza cada linha do rascunho (upsert -- funciona tanto
      // pra linha nova quanto pra linha que so teve a quantidade
      // alterada).
      for (const linha of linhasValidas) {
        const resp = await fetch("/api/produtos/composicao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku: skuOriginal,
            placaId: linha.placaId,
            pecasPorUnidade: Number(linha.pecasPorUnidade),
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error ?? "Erro ao salvar componente.");
        }
      }

      cancelarEdicao();
      carregar();
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluirProduto(sku: string) {
    if (
      !confirm(
        `Remover o SKU "${sku}" do catálogo de composição? Isso não apaga vendas nem estoque, só o vínculo com as placas.`
      )
    ) {
      return;
    }
    setSalvando(true);
    try {
      await fetch("/api/produtos/composicao", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku }),
      });
      if (skuEmEdicao === sku) cancelarEdicao();
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function criarNovoProduto() {
    setErroSalvar(null);
    const sku = novoSku.trim();
    if (!sku) {
      setErroSalvar("Informe a SKU do novo produto.");
      return;
    }
    const linhasValidas = linhasNovoProduto.filter((l) => l.placaId !== null);
    if (linhasValidas.length === 0) {
      setErroSalvar("Adicione ao menos uma placa componente.");
      return;
    }
    setSalvando(true);
    try {
      for (const linha of linhasValidas) {
        const pecas = Number(linha.pecasPorUnidade);
        if (!Number.isFinite(pecas) || pecas <= 0) {
          throw new Error(
            "Peças por unidade deve ser maior que zero em todas as linhas."
          );
        }
      }
      for (const linha of linhasValidas) {
        const resp = await fetch("/api/produtos/composicao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku,
            placaId: linha.placaId,
            pecasPorUnidade: Number(linha.pecasPorUnidade),
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error ?? "Erro ao criar produto.");
        }
      }
      setNovoProdutoAberto(false);
      setNovoSku("");
      setLinhasNovoProduto([novaLinhaRascunho()]);
      carregar();
    } catch (e) {
      setErroSalvar(e instanceof Error ? e.message : "Erro ao criar produto.");
    } finally {
      setSalvando(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando catálogo de produtos…
      </div>
    );
  }
  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Erro ao carregar produtos.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Produtos</h1>
          <p className="text-sm text-gray-500">
            Catálogo completo: cada SKU cadastrada e como ela é composta
            (placas, peças por unidade, tier).
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span className="rounded-full bg-gray-100 px-3 py-1">
            {produtos.length} SKUs cadastradas
          </span>
          {placasSemSku.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
              {placasSemSku.length} placas sem SKU vinculado
            </span>
          )}
          <button
            onClick={() => {
              cancelarEdicao();
              setErroSalvar(null);
              setNovoProdutoAberto((v) => !v);
            }}
            className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
          >
            {novoProdutoAberto ? "Cancelar" : "+ Novo produto"}
          </button>
        </div>
      </div>

      {novoProdutoAberto && (
        <div className="rounded-lg border border-gray-300 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Novo produto</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500">SKU</label>
            <input
              value={novoSku}
              onChange={(e) => setNovoSku(e.target.value)}
              placeholder="ex: 2 PORTA LAPIS LARANJA"
              className="w-72 rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {linhasNovoProduto.map((linha) => (
              <LinhaComponenteEditor
                key={linha.chave}
                linha={linha}
                placas={placasOpcoes}
                onChange={(patch) =>
                  setLinhasNovoProduto((atual) => atualizarLinha(atual, linha.chave, patch))
                }
                onRemover={
                  linhasNovoProduto.length > 1
                    ? () =>
                        setLinhasNovoProduto((atual) =>
                          atual.filter((l) => l.chave !== linha.chave)
                        )
                    : undefined
                }
              />
            ))}
            <button
              onClick={() =>
                setLinhasNovoProduto((atual) => [...atual, novaLinhaRascunho()])
              }
              className="w-fit text-xs font-medium text-blue-600 hover:underline"
            >
              + Adicionar placa
            </button>
          </div>
          {erroSalvar && <p className="mt-3 text-xs text-red-600">{erroSalvar}</p>}
          <div className="mt-4 flex gap-2">
            <button
              onClick={criarNovoProduto}
              disabled={salvando}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {salvando ? "Salvando…" : "Criar produto"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por SKU ou nome da placa…"
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={mostrarDescontinuadas}
            onChange={(e) => setMostrarDescontinuadas(e.target.checked)}
          />
          Mostrar descontinuadas
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Composição</th>
              <th className="px-4 py-2">Tier</th>
              <th className="px-4 py-2">Estoque vendável</th>
              <th className="px-4 py-2">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {produtosFiltrados.map((p) => {
              const vendavel = estoqueVendavelDoSku(p.componentes);
              const tiers = Array.from(new Set(p.componentes.map((c) => c.tier)));
              const emEdicao = skuEmEdicao === p.sku;
              return (
                <tr key={p.sku} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">{p.sku}</td>
                  <td className="px-4 py-3">
                    {emEdicao ? (
                      <div className="flex flex-col gap-2">
                        {linhasEdicao.map((linha) => (
                          <LinhaComponenteEditor
                            key={linha.chave}
                            linha={linha}
                            placas={placasOpcoes}
                            onChange={(patch) =>
                              setLinhasEdicao((atual) => atualizarLinha(atual, linha.chave, patch))
                            }
                            onRemover={() =>
                              setLinhasEdicao((atual) =>
                                atual.filter((l) => l.chave !== linha.chave)
                              )
                            }
                          />
                        ))}
                        <button
                          onClick={() =>
                            setLinhasEdicao((atual) => [...atual, novaLinhaRascunho()])
                          }
                          className="w-fit text-xs font-medium text-blue-600 hover:underline"
                        >
                          + Adicionar placa
                        </button>
                        {erroSalvar && <p className="text-xs text-red-600">{erroSalvar}</p>}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {p.componentes.map((c) => (
                          <div key={c.placaId} className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                              {c.papel ? LABEL_PAPEL[c.papel] ?? c.papel : "Peça única"}
                            </span>
                            <span className="text-gray-800">
                              #{c.placaNumero} {c.placaNome}
                            </span>
                            <span className="text-xs text-gray-500">
                              {c.pecasPorUnidade}× por unidade vendida
                            </span>
                            {c.pecasPorUnidade > 1 && c.skuPrincipal && (
                              <span
                                className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700"
                                title="SKU de 1 unidade que consome a mesma placa"
                              >
                                SKU principal: {c.skuPrincipal}
                              </span>
                            )}
                            {c.descontinuada && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-600">
                                descontinuada
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{tiers.join(" / ")}</td>
                  <td className="px-4 py-3 text-gray-800">{vendavel}</td>
                  <td className="px-4 py-3">
                    {emEdicao ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => salvarEdicao(p.sku)}
                          disabled={salvando}
                          className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          {salvando ? "Salvando…" : "Salvar"}
                        </button>
                        <button
                          onClick={cancelarEdicao}
                          disabled={salvando}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => iniciarEdicao(p)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => excluirProduto(p.sku)}
                          className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {produtosFiltrados.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {placasSemSku.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-800">
            Placas cadastradas sem nenhum SKU vinculado
          </h2>
          <p className="mt-1 text-xs text-amber-700">
            Essas placas existem no catálogo de produção mas ainda não têm
            nenhum SKU de venda apontando pra elas.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {placasSemSku.map((pl) => (
              <li
                key={pl.placaId}
                className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs text-amber-800"
              >
                #{pl.placaNumero} {pl.placaNome}
                {pl.papel ? ` (${LABEL_PAPEL[pl.papel] ?? pl.papel})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Uma linha de edicao de componente: escolher a placa (dropdown) e
// quantas pecas dela o SKU consome por unidade vendida. Usado tanto no
// formulario de "novo produto" quanto na edicao inline de um SKU ja
// existente. Se a placa selecionada nao estiver mais em /api/placas
// (por ter sido descontinuada), mostra o rotuloFallback pra nao ficar
// com o dropdown em branco.
function LinhaComponenteEditor({
  linha,
  placas,
  onChange,
  onRemover,
}: {
  linha: LinhaRascunho;
  placas: PlacaOpcao[];
  onChange: (patch: Partial<LinhaRascunho>) => void;
  onRemover?: () => void;
}) {
  const opcoesAtivas = placas.filter((pl) => !pl.descontinuada || pl.id === linha.placaId);
  const placaNaLista = opcoesAtivas.some((pl) => pl.id === linha.placaId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={linha.placaId ?? ""}
        onChange={(e) =>
          onChange({ placaId: e.target.value ? Number(e.target.value) : null })
        }
        className="rounded border border-gray-300 px-2 py-1 text-xs"
      >
        <option value="">Escolher placa…</option>
        {!placaNaLista && linha.placaId !== null && (
          <option value={linha.placaId}>
            {linha.rotuloFallback ?? `Placa #${linha.placaId} (descontinuada)`}
          </option>
        )}
        {opcoesAtivas.map((pl) => (
          <option key={pl.id} value={pl.id}>
            #{pl.numero} {pl.nome}
            {pl.papel ? ` (${LABEL_PAPEL[pl.papel] ?? pl.papel})` : ""}
          </option>
        ))}
      </select>
      <input
        type="number"
        min={1}
        value={linha.pecasPorUnidade}
        onChange={(e) => onChange({ pecasPorUnidade: e.target.value })}
        className="w-16 rounded border border-gray-300 px-2 py-1 text-xs"
      />
      <span className="text-[11px] text-gray-500">peças/un.</span>
      {onRemover && (
        <button onClick={onRemover} className="text-xs text-red-500 hover:underline">
          remover
        </button>
      )}
    </div>
  );
}
