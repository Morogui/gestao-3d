"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIAS_DESPESA,
  CATEGORIAS_RECEITA,
  LancamentoFinanceiro,
  CompraFilamento,
} from "@/lib/financeiro";
import { CORES_FILAMENTO } from "@/lib/placas";
import { formatDiaBR } from "@/lib/date";

type Status = "loading" | "ready" | "erro";

interface Resumo {
  totalDespesas: number;
  totalReceitas: number;
  saldo: number;
  despesasPendentes: number;
  despesasPendentesValor: number;
}

interface ExtracaoIA {
  tipo: "despesa" | "receita";
  valor: number;
  data: string;
  categoria: string;
  descricao: string;
  fornecedor: string | null;
}

interface RascunhoLancamento {
  tipo: "despesa" | "receita";
  categoria: string;
  descricao: string;
  valor: string;
  dataVencimento: string;
  fornecedor: string;
  arquivoNome?: string | null;
  arquivoMime?: string | null;
  arquivoBase64?: string | null;
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function mesAtual(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function labelMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

function somarMes(mes: string, delta: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const rascunhoVazio = (tipo: "despesa" | "receita" = "despesa"): RascunhoLancamento => ({
  tipo,
  categoria: "",
  descricao: "",
  valor: "",
  dataVencimento: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
  fornecedor: "",
});

export default function FinanceiroPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [mes, setMes] = useState(mesAtual());
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [diaFiltro, setDiaFiltro] = useState<string | null>(null);

  const [compras, setCompras] = useState<CompraFilamento[]>([]);
  const [custoMedioPorCor, setCustoMedioPorCor] = useState<Record<string, number>>({});
  const [custoMedioGeral, setCustoMedioGeral] = useState<number | null>(null);

  const [rascunho, setRascunho] = useState<RascunhoLancamento | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const [salvandoLancamento, setSalvandoLancamento] = useState(false);

  const [novaCompra, setNovaCompra] = useState({
    cor: "branco",
    gramas: "",
    valorPago: "",
    dataCompra: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
    fornecedor: "",
  });
  const [salvandoCompra, setSalvandoCompra] = useState(false);

  async function carregarLancamentos(mesAlvo: string) {
    try {
      const res = await fetch(`/api/financeiro/lancamentos?mes=${mesAlvo}`);
      if (!res.ok) throw new Error("falha");
      const data = await res.json();
      setLancamentos(data.lancamentos);
      setResumo(data.resumo);
      setStatus("ready");
    } catch {
      setStatus("erro");
    }
  }

  async function carregarCompras() {
    const res = await fetch("/api/financeiro/compras-filamento");
    if (!res.ok) return;
    const data = await res.json();
    setCompras(data.compras);
    setCustoMedioPorCor(data.custoMedioPorCor);
    setCustoMedioGeral(data.custoMedioGeral);
  }

  useEffect(() => {
    carregarLancamentos(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  useEffect(() => {
    carregarCompras();
  }, []);

  const lancamentosFiltrados = useMemo(() => {
    if (!diaFiltro) return lancamentos;
    return lancamentos.filter((l) => l.dataVencimento === diaFiltro);
  }, [lancamentos, diaFiltro]);

  async function analisarComIA(file: File) {
    setAnalisando(true);
    setErroIA(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/financeiro/ler-documento", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setErroIA(data.error ?? "Não deu pra ler o documento.");
        if (data.arquivoBase64) {
          setRascunho({
            ...rascunhoVazio(),
            arquivoNome: data.arquivoNome,
            arquivoMime: data.arquivoMime,
            arquivoBase64: data.arquivoBase64,
          });
        }
        return;
      }
      const extraido = data.extraido as ExtracaoIA;
      setRascunho({
        tipo: extraido.tipo,
        categoria: extraido.categoria,
        descricao: extraido.descricao,
        valor: extraido.valor ? String(extraido.valor) : "",
        dataVencimento: extraido.data || rascunhoVazio().dataVencimento,
        fornecedor: extraido.fornecedor ?? "",
        arquivoNome: data.arquivoNome,
        arquivoMime: data.arquivoMime,
        arquivoBase64: data.arquivoBase64,
      });
    } catch {
      setErroIA("Não deu pra conectar com a IA. Preencha manualmente.");
    } finally {
      setAnalisando(false);
    }
  }

  async function salvarRascunho() {
    if (!rascunho) return;
    const valor = Number(rascunho.valor.replace(",", "."));
    if (!rascunho.categoria || !Number.isFinite(valor) || valor <= 0 || !rascunho.dataVencimento) {
      setErroIA("Preencha categoria, valor (> 0) e data.");
      return;
    }
    setSalvandoLancamento(true);
    try {
      const res = await fetch("/api/financeiro/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: rascunho.tipo,
          categoria: rascunho.categoria,
          descricao: rascunho.descricao,
          valor,
          dataVencimento: rascunho.dataVencimento,
          fornecedor: rascunho.fornecedor || null,
          arquivoNome: rascunho.arquivoNome ?? null,
          arquivoMime: rascunho.arquivoMime ?? null,
          arquivoBase64: rascunho.arquivoBase64 ?? null,
        }),
      });
      if (res.ok) {
        setRascunho(null);
        setErroIA(null);
        if (rascunho.dataVencimento.slice(0, 7) === mes) {
          await carregarLancamentos(mes);
        }
      } else {
        const data = await res.json();
        setErroIA(data.error ?? "Não deu pra salvar.");
      }
    } finally {
      setSalvandoLancamento(false);
    }
  }

  async function marcarStatus(id: number, novoStatus: "pago" | "pendente") {
    await fetch(`/api/financeiro/lancamentos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus }),
    });
    await carregarLancamentos(mes);
  }

  async function excluirLancamento(id: number) {
    await fetch(`/api/financeiro/lancamentos/${id}`, { method: "DELETE" });
    await carregarLancamentos(mes);
  }

  async function salvarCompra() {
    const gramas = Number(novaCompra.gramas.replace(",", "."));
    const valorPago = Number(novaCompra.valorPago.replace(",", "."));
    if (!Number.isFinite(gramas) || gramas <= 0 || !Number.isFinite(valorPago) || valorPago <= 0) {
      return;
    }
    setSalvandoCompra(true);
    try {
      const res = await fetch("/api/financeiro/compras-filamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cor: novaCompra.cor,
          gramas,
          valorPago,
          dataCompra: novaCompra.dataCompra,
          fornecedor: novaCompra.fornecedor || null,
        }),
      });
      if (res.ok) {
        setNovaCompra({ ...novaCompra, gramas: "", valorPago: "", fornecedor: "" });
        await carregarCompras();
      }
    } finally {
      setSalvandoCompra(false);
    }
  }

  async function excluirCompra(id: number) {
    await fetch(`/api/financeiro/compras-filamento/${id}`, { method: "DELETE" });
    await carregarCompras();
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando financeiro...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar o financeiro. Tente recarregar a página.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Receitas do mês" value={formatBRL(resumo?.totalReceitas ?? 0)} tone="green" />
        <Card label="Despesas do mês" value={formatBRL(resumo?.totalDespesas ?? 0)} tone="red" />
        <Card
          label="Saldo do mês"
          value={formatBRL(resumo?.saldo ?? 0)}
          tone={(resumo?.saldo ?? 0) >= 0 ? "green" : "red"}
        />
        <Card
          label="Despesas pendentes"
          value={`${resumo?.despesasPendentes ?? 0} · ${formatBRL(resumo?.despesasPendentesValor ?? 0)}`}
          tone="amber"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setMes(somarMes(mes, -1))}
          className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
        >
          ←
        </button>
        <span className="text-sm font-medium capitalize text-gray-700">{labelMes(mes)}</span>
        <button
          onClick={() => setMes(somarMes(mes, 1))}
          className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50"
        >
          →
        </button>
        {diaFiltro && (
          <button
            onClick={() => setDiaFiltro(null)}
            className="ml-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200"
          >
            Filtrando dia {formatDiaBR(diaFiltro)} · limpar ×
          </button>
        )}
      </div>

      <CalendarioPagamentos
        mes={mes}
        lancamentos={lancamentos}
        diaSelecionado={diaFiltro}
        onSelecionarDia={(dia) => setDiaFiltro(dia === diaFiltro ? null : dia)}
      />

      <UploadComprovante
        analisando={analisando}
        erro={erroIA}
        onArquivo={analisarComIA}
        onNovoManual={() => setRascunho(rascunhoVazio())}
      />

      {rascunho && (
        <FormularioRevisao
          rascunho={rascunho}
          salvando={salvandoLancamento}
          erro={erroIA}
          onMudar={setRascunho}
          onSalvar={salvarRascunho}
          onCancelar={() => {
            setRascunho(null);
            setErroIA(null);
          }}
        />
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Fornecedor</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lancamentosFiltrados.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                  Nenhum lançamento nesse mês.
                </td>
              </tr>
            )}
            {lancamentosFiltrados.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-gray-600">{formatDiaBR(l.dataVencimento)}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      "rounded px-1.5 py-0.5 text-xs font-semibold " +
                      (l.tipo === "receita" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")
                    }
                  >
                    {l.tipo === "receita" ? "Receita" : "Despesa"}
                  </span>
                </td>
                <td className="px-3 py-2">{l.categoria}</td>
                <td className="px-3 py-2 text-gray-600">{l.descricao || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{l.fornecedor || "—"}</td>
                <td className="px-3 py-2 text-right font-medium">{formatBRL(l.valor)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => marcarStatus(l.id, l.status === "pago" ? "pendente" : "pago")}
                    className={
                      "rounded px-1.5 py-0.5 text-xs font-semibold " +
                      (l.status === "pago"
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-200")
                    }
                  >
                    {l.status === "pago" ? "Pago" : "Pendente"}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => excluirLancamento(l.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ComprasFilamento
        compras={compras}
        custoMedioPorCor={custoMedioPorCor}
        custoMedioGeral={custoMedioGeral}
        novaCompra={novaCompra}
        salvando={salvandoCompra}
        onMudar={setNovaCompra}
        onSalvar={salvarCompra}
        onExcluir={excluirCompra}
      />
    </div>
  );
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "amber";
}) {
  const cor =
    tone === "green" ? "text-green-700" : tone === "red" ? "text-red-700" : "text-amber-700";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${cor}`}>{value}</p>
    </div>
  );
}

function CalendarioPagamentos({
  mes,
  lancamentos,
  diaSelecionado,
  onSelecionarDia,
}: {
  mes: string;
  lancamentos: LancamentoFinanceiro[];
  diaSelecionado: string | null;
  onSelecionarDia: (dia: string) => void;
}) {
  const [ano, m] = mes.split("-").map(Number);
  const diasNoMes = new Date(ano, m, 0).getDate();
  const primeiroDiaSemana = new Date(ano, m - 1, 1).getDay();

  const porDia = useMemo(() => {
    const mapa = new Map<string, LancamentoFinanceiro[]>();
    for (const l of lancamentos) {
      const lista = mapa.get(l.dataVencimento) ?? [];
      lista.push(l);
      mapa.set(l.dataVencimento, lista);
    }
    return mapa;
  }, [lancamentos]);

  const celulas: (string | null)[] = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let dia = 1; dia <= diasNoMes; dia++) {
    celulas.push(`${mes}-${String(dia).padStart(2, "0")}`);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold uppercase text-gray-400">
        {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {celulas.map((dia, i) => {
          if (!dia) return <div key={`vazio-${i}`} />;
          const itens = porDia.get(dia) ?? [];
          const temPendente = itens.some((l) => l.tipo === "despesa" && l.status === "pendente");
          const temPago = itens.some((l) => l.status === "pago");
          const temReceita = itens.some((l) => l.tipo === "receita");
          const selecionado = dia === diaSelecionado;
          return (
            <button
              key={dia}
              onClick={() => onSelecionarDia(dia)}
              className={
                "flex h-14 flex-col items-center justify-start rounded border p-1 text-xs " +
                (selecionado
                  ? "border-blue-500 bg-blue-50"
                  : itens.length > 0
                  ? "border-gray-200 hover:bg-gray-50"
                  : "border-transparent text-gray-400 hover:bg-gray-50")
              }
            >
              <span className="font-medium">{Number(dia.slice(-2))}</span>
              <span className="mt-1 flex gap-0.5">
                {temPendente && <span className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                {temPago && <span className="h-1.5 w-1.5 rounded-full bg-green-500" />}
                {temReceita && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> despesa pendente
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> pago
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> receita
        </span>
      </div>
    </div>
  );
}

function UploadComprovante({
  analisando,
  erro,
  onArquivo,
  onNovoManual,
}: {
  analisando: boolean;
  erro: string | null;
  onArquivo: (file: File) => void;
  onNovoManual: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-4">
      <label className="cursor-pointer rounded bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700">
        {analisando ? "Analisando com IA..." : "Subir comprovante (PDF/PNG/JPG)"}
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/jpg"
          className="hidden"
          disabled={analisando}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onArquivo(file);
            e.target.value = "";
          }}
        />
      </label>
      <button
        onClick={onNovoManual}
        className="rounded border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        + Lançamento manual
      </button>
      <p className="text-xs text-gray-400">
        A IA lê o documento e preenche os campos — você confirma antes de salvar.
      </p>
      {erro && <p className="w-full text-xs text-red-600">{erro}</p>}
    </div>
  );
}

function FormularioRevisao({
  rascunho,
  salvando,
  erro,
  onMudar,
  onSalvar,
  onCancelar,
}: {
  rascunho: RascunhoLancamento;
  salvando: boolean;
  erro: string | null;
  onMudar: (r: RascunhoLancamento) => void;
  onSalvar: () => void;
  onCancelar: () => void;
}) {
  const categorias = rascunho.tipo === "despesa" ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA;
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
      <p className="mb-3 text-sm font-medium text-gray-700">
        {rascunho.arquivoNome ? `Revise os dados extraídos de "${rascunho.arquivoNome}"` : "Novo lançamento"}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-500">
          Tipo
          <select
            value={rascunho.tipo}
            onChange={(e) =>
              onMudar({ ...rascunho, tipo: e.target.value as "despesa" | "receita", categoria: "" })
            }
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Categoria
          <input
            list="categorias-financeiro"
            value={rascunho.categoria}
            onChange={(e) => onMudar({ ...rascunho, categoria: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <datalist id="categorias-financeiro">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-gray-500">
          Valor (R$)
          <input
            value={rascunho.valor}
            onChange={(e) => onMudar({ ...rascunho, valor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="0,00"
          />
        </label>
        <label className="text-xs text-gray-500">
          Data de vencimento/pagamento
          <input
            type="date"
            value={rascunho.dataVencimento}
            onChange={(e) => onMudar({ ...rascunho, dataVencimento: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-2">
          Fornecedor/cliente
          <input
            value={rascunho.fornecedor}
            onChange={(e) => onMudar({ ...rascunho, fornecedor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-3">
          Descrição
          <input
            value={rascunho.descricao}
            onChange={(e) => onMudar({ ...rascunho, descricao: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onSalvar}
          disabled={salvando}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {salvando ? "Salvando..." : "Salvar lançamento"}
        </button>
        <button
          onClick={onCancelar}
          className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ComprasFilamento({
  compras,
  custoMedioPorCor,
  custoMedioGeral,
  novaCompra,
  salvando,
  onMudar,
  onSalvar,
  onExcluir,
}: {
  compras: CompraFilamento[];
  custoMedioPorCor: Record<string, number>;
  custoMedioGeral: number | null;
  novaCompra: { cor: string; gramas: string; valorPago: string; dataCompra: string; fornecedor: string };
  salvando: boolean;
  onMudar: (v: typeof novaCompra) => void;
  onSalvar: () => void;
  onExcluir: (id: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm font-semibold text-gray-700">Compras de filamento — custo médio</p>
      <p className="text-xs text-gray-500">
        Custo médio ponderado (soma do valor pago ÷ soma dos gramas) — é o preço real do filamento
        pra entrar na precificação, considerando todas as compras já lançadas.
      </p>

      <div className="flex flex-wrap gap-3">
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <p className="text-gray-500">Custo médio geral</p>
          <p className="font-semibold text-gray-800">
            {custoMedioGeral !== null ? `${formatBRL(custoMedioGeral * 1000)}/kg` : "sem dados"}
          </p>
        </div>
        {CORES_FILAMENTO.map((cor) => (
          <div key={cor} className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
            <p className="capitalize text-gray-500">{cor}</p>
            <p className="font-semibold text-gray-800">
              {custoMedioPorCor[cor] !== undefined ? `${formatBRL(custoMedioPorCor[cor] * 1000)}/kg` : "sem dados"}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <label className="text-xs text-gray-500">
          Cor
          <select
            value={novaCompra.cor}
            onChange={(e) => onMudar({ ...novaCompra, cor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm capitalize"
          >
            {CORES_FILAMENTO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Gramas
          <input
            value={novaCompra.gramas}
            onChange={(e) => onMudar({ ...novaCompra, gramas: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="1000"
          />
        </label>
        <label className="text-xs text-gray-500">
          Valor pago (R$)
          <input
            value={novaCompra.valorPago}
            onChange={(e) => onMudar({ ...novaCompra, valorPago: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="0,00"
          />
        </label>
        <label className="text-xs text-gray-500">
          Data da compra
          <input
            type="date"
            value={novaCompra.dataCompra}
            onChange={(e) => onMudar({ ...novaCompra, dataCompra: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500 sm:col-span-1">
          Fornecedor
          <input
            value={novaCompra.fornecedor}
            onChange={(e) => onMudar({ ...novaCompra, fornecedor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex items-end">
          <button
            onClick={onSalvar}
            disabled={salvando}
            className="w-full rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {salvando ? "Salvando..." : "+ Compra"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Cor</th>
              <th className="px-3 py-2 text-right">Gramas</th>
              <th className="px-3 py-2 text-right">Valor pago</th>
              <th className="px-3 py-2 text-right">R$/kg</th>
              <th className="px-3 py-2">Fornecedor</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {compras.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-gray-400">
                  Nenhuma compra lançada ainda.
                </td>
              </tr>
            )}
            {compras.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 text-gray-600">{formatDiaBR(c.dataCompra)}</td>
                <td className="px-3 py-2 capitalize">{c.cor}</td>
                <td className="px-3 py-2 text-right">{c.gramas.toLocaleString("pt-BR")}g</td>
                <td className="px-3 py-2 text-right">{formatBRL(c.valorPago)}</td>
                <td className="px-3 py-2 text-right">{formatBRL((c.valorPago / c.gramas) * 1000)}</td>
                <td className="px-3 py-2 text-gray-600">{c.fornecedor || "—"}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => onExcluir(c.id)}
                    className="text-xs text-gray-400 hover:text-red-600"
                  >
                    excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
