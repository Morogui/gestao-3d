"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calcularCusto,
  DEFAULT_PARAMS,
  formatBRL,
  GlobalParams,
  ProdutoInput,
} from "@/lib/custo";
import {
  atualizarProduto,
  criarProduto,
  excluirProduto,
  loadParams,
  loadProdutos,
  saveParams,
} from "@/lib/storage";
import ProdutosTable from "./ProdutosTable";

function normalizarBusca(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}

function palavrasSignificativas(s: string): string[] {
  return normalizarBusca(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

// Pedido do Guilherme em 2026-08-18: avisar quando o SKU digitado no
// Custo parece divergir do SKU real usado nas vendas (ex: "REGUA BOLO
// 5X10" cadastrado, mas a venda real usa "REGUA 5X10") — nesses casos
// o vinculo automatico cria a placa, mas a venda continua aparecendo
// como nao identificada na Producao porque o SKU nao bate exatamente.
function acharDivergenciaSku(
  produto: Pick<ProdutoInput, "nome" | "sku">,
  vendasNaoIdentificadas: { titulo: string; sku: string }[]
): { titulo: string; sku: string } | null {
  const skuProduto = normalizarBusca(produto.sku || produto.nome);
  const palavrasProduto = palavrasSignificativas(produto.nome);
  if (palavrasProduto.length === 0) return null;
  for (const venda of vendasNaoIdentificadas) {
    const skuVenda = normalizarBusca(venda.sku || "");
    if (!skuVenda || skuVenda === skuProduto) continue;
    const palavrasVenda = palavrasSignificativas(`${venda.titulo} ${venda.sku}`);
    const overlap = palavrasProduto.filter((w) => palavrasVenda.includes(w)).length;
    if (overlap >= 2) return venda;
  }
  return null;
}

const EMPTY_FORM: Omit<ProdutoInput, "id"> = {
  nome: "",
  sku: "",
  pesoPlacaG: 0,
  tempoPlacaH: 0,
  pecasNaPlaca: 1,
};

export default function CustoCalculator() {
  const [params, setParams] = useState<GlobalParams>(DEFAULT_PARAMS);
  const [produtos, setProdutos] = useState<ProdutoInput[]>([]);
  const [form, setForm] = useState<Omit<ProdutoInput, "id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvandoParams, setSalvandoParams] = useState(false);
  const [paramsSalvos, setParamsSalvos] = useState(true);
  // Busca de produtos cadastrados — pedido do Guilherme em 2026-08-04,
  // olhando a tabela crescer (46+ produtos): "Deve ter um campo para
  // buscar os produtos cadastrados". Filtra por nome OU SKU, sem
  // acento/maiúscula (mesmo padrão de normalização usado em
  // lib/demanda.ts) pra achar mesmo digitando diferente do cadastro.
  const [busca, setBusca] = useState("");
  const [naoIdentificados, setNaoIdentificados] = useState<
    { titulo: string; sku: string }[]
  >([]);

  // Carrega dados salvos do banco assim que o componente monta
  useEffect(() => {
    (async () => {
      const [paramsCarregados, produtosCarregados] = await Promise.all([
        loadParams(),
        loadProdutos(),
      ]);
      setParams(paramsCarregados);
      setProdutos(produtosCarregados);
      setLoading(false);
    })();
    (async () => {
      try {
        const res = await fetch("/api/producao/demanda");
        if (!res.ok) return;
        const data = await res.json();
        const amostras: { titulo: string; sku: string }[] = [
          ...(data?.naoIdentificado?.amostras ?? []),
          ...(data?.naoIdentificadoSemana?.amostras ?? []),
        ];
        const vistos = new Set<string>();
        const unicas = amostras.filter((a) => {
          const chave = `${a.titulo}__${a.sku}`;
          if (vistos.has(chave)) return false;
          vistos.add(chave);
          return true;
        });
        setNaoIdentificados(unicas);
      } catch {
        // silencioso — e so um alerta visual, nao deve travar a tela
      }
    })();
  }, []);

  const preview = useMemo(() => calcularCusto(form, params), [form, params]);

  const produtosFiltrados = useMemo(() => {
    const alvo = normalizarBusca(busca);
    if (!alvo) return produtos;
    return produtos.filter(
      (p) =>
        normalizarBusca(p.nome).includes(alvo) ||
        normalizarBusca(p.sku ?? "").includes(alvo)
    );
  }, [produtos, busca]);

  const divergencias = useMemo(() => {
    const mapa: Record<string, { titulo: string; sku: string }> = {};
    if (naoIdentificados.length === 0) return mapa;
    for (const produto of produtos) {
      const achado = acharDivergenciaSku(produto, naoIdentificados);
      if (achado) mapa[produto.id] = achado;
    }
    return mapa;
  }, [produtos, naoIdentificados]);

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateParam<K extends keyof GlobalParams>(key: K, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }));
    setParamsSalvos(false);
  }

  async function handleSalvarParams() {
    setSalvandoParams(true);
    try {
      const salvos = await saveParams(params);
      setParams(salvos);
      setParamsSalvos(true);
    } finally {
      setSalvandoParams(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return;

    if (editingId) {
      const atualizado = await atualizarProduto({ ...form, id: editingId });
      setProdutos((prev) => prev.map((p) => (p.id === editingId ? atualizado : p)));
    } else {
      const criado = await criarProduto(form);
      setProdutos((prev) =>
        [...prev, criado].sort((a, b) => a.nome.localeCompare(b.nome))
      );
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function handleEdit(produto: ProdutoInput) {
    const { id, ...rest } = produto;
    setForm(rest);
    setEditingId(id);
  }

  async function handleDelete(id: string) {
    setProdutos((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) {
      setForm(EMPTY_FORM);
      setEditingId(null);
    }
    await excluirProduto(id);
  }

  function handleCancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando produtos...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Parâmetros globais */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Parâmetros de custo
          </h2>
          <div className="flex items-center gap-2">
            {paramsSalvos ? (
              <span className="text-xs text-gray-400">Salvo</span>
            ) : (
              <span className="text-xs text-amber-600">Alterações não salvas</span>
            )}
            <button
              type="button"
              onClick={handleSalvarParams}
              disabled={salvandoParams || paramsSalvos}
              className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {salvandoParams ? "Salvando..." : "Salvar parâmetros"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="block">
                   <span className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-600">
                                Filamento (R$/kg)
                                <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                                              Automatico
                                </span>
                    </span>
                    <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                      {params.precoFilamentoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className="mt-1 block text-[11px] text-gray-400">
                                Media do mes (compras de filamento chegadas) - nao editavel
                    </span>
          </div>
          <NumberField
            label="Energia (R$/h)"
            value={params.energiaHora}
            onChange={(v) => updateParam("energiaHora", v)}
            step={0.01}
          />
          <NumberField
            label="Manutenção (R$/h)"
            value={params.manutencaoHora}
            onChange={(v) => updateParam("manutencaoHora", v)}
            step={0.01}
          />
          <NumberField
            label="Falha de impressão (%)"
            value={params.falhaImpressao * 100}
            onChange={(v) => updateParam("falhaImpressao", v / 100)}
            step={0.1}
          />
        </div>
      </section>

      {/* Formulário do produto + preview */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          {editingId ? "Editar produto" : "Novo produto"}
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              label="Nome / código do produto"
              value={form.nome}
              onChange={(v) => updateForm("nome", v)}
              required
            />
            <TextField
              label="SKU (opcional)"
              value={form.sku}
              onChange={(v) => updateForm("sku", v)}
            />
            <NumberField
              label="Peso da placa (g)"
              value={form.pesoPlacaG}
              onChange={(v) => updateForm("pesoPlacaG", v)}
              step={0.1}
            />
            <NumberField
              label="Tempo da placa (h)"
              value={form.tempoPlacaH}
              onChange={(v) => updateForm("tempoPlacaH", v)}
              step={0.1}
            />
            <NumberField
              label="Peças na placa"
              value={form.pecasNaPlaca}
              onChange={(v) => updateForm("pecasNaPlaca", v)}
              step={1}
            />
            <div className="flex gap-3 sm:col-span-2">
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                {editingId ? "Salvar alterações" : "Adicionar produto"}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>

          {/* Preview do cálculo */}
          <div className="rounded-md bg-gray-50 p-4 text-sm">
            <h3 className="mb-3 font-semibold text-gray-900">
              Prévia do cálculo
            </h3>
            <dl className="space-y-1.5">
              <Row label="Custo filamento" value={formatBRL(preview.custoFilamento)} />
              <Row label="Custo energia" value={formatBRL(preview.custoEnergia)} />
              <Row label="Custo manutenção" value={formatBRL(preview.custoManutencao)} />
              <Row label="Custo da placa" value={formatBRL(preview.custoPlaca)} bold />
              <Row
                label="Custo da placa c/ falha"
                value={formatBRL(preview.custoPlacaComFalha)}
              />
              <Row
                label="Custo unitário (por peça)"
                value={formatBRL(preview.custoUnitario)}
                bold
              />
            </dl>
          </div>
        </form>
      </section>

      {/* Lista de produtos cadastrados */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">
            Produtos cadastrados
            <span className="ml-2 font-normal text-gray-400">
              ({produtosFiltrados.length}
              {busca.trim() ? ` de ${produtos.length}` : ""})
            </span>
          </h2>
          <div className="relative w-full sm:w-64">
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou SKU..."
              className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-7 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">
              🔍
            </span>
            {busca && (
              <button
                type="button"
                onClick={() => setBusca("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {produtos.length > 0 && produtosFiltrados.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Nenhum produto encontrado para &quot;{busca}&quot;.
          </div>
        ) : (
          <ProdutosTable
            produtos={produtosFiltrados}
            params={params}
            onEdit={handleEdit}
            onDelete={handleDelete}
            divergencias={divergencias}
          />
        )}
      </section>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={bold ? "font-semibold text-gray-900" : "text-gray-700"}>
        {value}
      </dd>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="text"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );
}
