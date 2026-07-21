"use client";

import { useEffect, useMemo, useState } from "react";
import {
  calcularCusto,
  DEFAULT_PARAMS,
  formatBRL,
  GlobalParams,
  ProdutoInput,
} from "@/lib/custo";
import { loadParams, loadProdutos, saveParams, saveProdutos } from "@/lib/storage";
import ProdutosTable from "./ProdutosTable";

const EMPTY_FORM: Omit<ProdutoInput, "id"> = {
  nome: "",
  pesoPlacaG: 0,
  tempoPlacaH: 0,
  pecasNaPlaca: 1,
};

function newId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function CustoCalculator() {
  const [params, setParams] = useState<GlobalParams>(DEFAULT_PARAMS);
  const [produtos, setProdutos] = useState<ProdutoInput[]>([]);
  const [form, setForm] = useState<Omit<ProdutoInput, "id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Carrega dados salvos assim que o componente monta no navegador
  useEffect(() => {
    setParams(loadParams());
    setProdutos(loadProdutos());
    setHydrated(true);
  }, []);

  // Persiste sempre que params/produtos mudam (depois da carga inicial)
  useEffect(() => {
    if (!hydrated) return;
    saveParams(params);
  }, [params, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveProdutos(produtos);
  }, [produtos, hydrated]);

  const preview = useMemo(() => calcularCusto(form, params), [form, params]);

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateParam<K extends keyof GlobalParams>(key: K, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return;

    if (editingId) {
      setProdutos((prev) =>
        prev.map((p) => (p.id === editingId ? { ...form, id: editingId } : p))
      );
    } else {
      setProdutos((prev) => [...prev, { ...form, id: newId() }]);
    }
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function handleEdit(produto: ProdutoInput) {
    const { id, ...rest } = produto;
    setForm(rest);
    setEditingId(id);
  }

  function handleDelete(id: string) {
    setProdutos((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) {
      setForm(EMPTY_FORM);
      setEditingId(null);
    }
  }

  function handleCancelEdit() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Parâmetros globais */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          Parâmetros de custo
        </h2>
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
