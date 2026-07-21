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

const EMPTY_FORM: Omit<ProdutoInput, "id"> = {
  nome: "",
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
  }, []);

  const preview = useMemo(() => calcularCusto(form, params), [form, params]);

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
          <NumberField
            label="Filamento (R$/kg)"
            value={params.precoFilamentoKg}
            onChange={(v) => updateParam("precoFilamentoKg", v)}
            step={0.01}
          />
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
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Produtos cadastrados
        </h2>
        <ProdutosTable
          produtos={produtos}
          params={params}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
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
