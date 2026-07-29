"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { formatDiaBR } from "@/lib/date";
import { labelCorFilamento } from "@/lib/placas";

// Aba Relatórios — pedido do Guilherme em 2026-07-29: "devemos criar
// uma nova aba com detalhes e gerador de arquivos... que vamos precisar
// conseguir baixar como documento pro excel", depois "separando por
// nome dos meses que tivermos os registros", e depois "adicionar um
// campo para comprovantes... esse arquivo deve se manter todos como
// fotos". Pensada como um hub que cresce aos poucos — cada bloco abaixo
// é um "relatório" independente (dados + agrupamento por mês + jeito de
// baixar), e mais blocos entram aqui conforme o Guilherme for pedindo,
// sem mexer nos que já existem.
//
// Movimentação de filamento: reusa o mesmo endpoint que já alimenta o
// histórico da aba Estoque (ver /api/producao/filamento/historico),
// mas pedindo bem mais linhas (?limit=5000) pra trazer TUDO, não só as
// últimas ~100. Gera um .xlsx com UMA ABA POR MÊS (nome da aba = nome
// do mês), usando a biblioteca xlsx (SheetJS) direto no navegador — sem
// precisar de servidor de arquivos.
//
// Comprovantes: os arquivos de comprovante ficam gravados como
// foto/PDF original (base64) — pedido do Guilherme: "esse arquivo deve
// se manter todos como fotos", ou seja, NÃO tenta converter/embutir
// essas imagens dentro do Excel. Em vez disso lista os comprovantes
// agrupados por mês com um link "abrir" que baixa o arquivo original
// (mesma rota /api/financeiro/lancamentos/[id]/arquivo já usada na aba
// Financeiro), preservando o arquivo exatamente como foi enviado.

type TipoMovimento = "producao" | "falha" | "perda_avulsa" | "ajuste_manual" | "compra";

interface Movimento {
  data: string;
  cor: string;
  tipo: TipoMovimento;
  gramas: number;
  detalhe: string;
}

interface ComprovanteResumo {
  id: number;
  tipo: "despesa" | "receita";
  categoria: string;
  descricao: string;
  valor: number;
  dataVencimento: string;
  fornecedor: string | null;
  formaPagamento: string | null;
  arquivoNome: string;
  arquivoMime: string;
}

const LABEL_TIPO_MOVIMENTO: Record<TipoMovimento, string> = {
  producao: "Produção concluída",
  falha: "Falha na placa",
  perda_avulsa: "Perda avulsa",
  ajuste_manual: "Ajuste manual",
  compra: "Compra (Financeiro)",
};

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function chaveDoMes(dataISO: string): string {
  return dataISO.slice(0, 7); // YYYY-MM
}

function labelDoMes(chave: string): string {
  const [ano, mes] = chave.split("-").map(Number);
  const nome = NOMES_MES[mes - 1] ?? chave;
  return `${nome} de ${ano}`;
}

function agruparPorMes<T extends { data: string }>(
  itens: T[]
): { chave: string; label: string; itens: T[] }[] {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const chave = chaveDoMes(item.data);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave)!.push(item);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([chave, lista]) => ({ chave, label: labelDoMes(chave), itens: lista }));
}

function formatGramasRelatorio(gramas: number): string {
  return gramas.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatBRLRelatorio(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function RelatoriosPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Relatórios</h1>
        <p className="text-sm text-gray-500">
          Dados detalhados, separados por mês, prontos pra baixar como Excel ou abrir o arquivo
          original.
        </p>
      </div>
      <RelatorioMovimentacaoFilamento />
      <RelatorioComprovantes />
    </div>
  );
}

function RelatorioMovimentacaoFilamento() {
  const [status, setStatus] = useState<"loading" | "ready" | "erro">("loading");
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [mesesFechados, setMesesFechados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/producao/filamento/historico?limit=5000");
        if (!res.ok) throw new Error("falha");
        const data = await res.json();
        setMovimentos(data.movimentos);
        setStatus("ready");
      } catch {
        setStatus("erro");
      }
    })();
  }, []);

  const grupos = useMemo(() => agruparPorMes(movimentos), [movimentos]);

  function alternarMes(chave: string) {
    setMesesFechados((atual) => ({ ...atual, [chave]: !atual[chave] }));
  }

  function baixarExcel() {
    const wb = XLSX.utils.book_new();
    for (const grupo of grupos) {
      const linhas = grupo.itens.map((m) => ({
        Data: new Date(m.data).toLocaleDateString("pt-BR"),
        Cor: labelCorFilamento(m.cor),
        Tipo: LABEL_TIPO_MOVIMENTO[m.tipo],
        Gramas: m.gramas,
        Detalhe: m.detalhe,
      }));
      const ws = XLSX.utils.json_to_sheet(linhas);
      // Nome de aba do Excel tem limite de 31 caracteres e não aceita
      // alguns símbolos (: \ / ? * [ ]) — o nome do mês já é seguro.
      XLSX.utils.book_append_sheet(wb, ws, grupo.label.slice(0, 31));
    }
    XLSX.writeFile(wb, `movimentacao-filamento-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Movimentação de filamento</h2>
        <button
          onClick={baixarExcel}
          disabled={status !== "ready" || grupos.length === 0}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Baixar Excel
        </button>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Toda entrada e saída de filamento (produção, falha, perda avulsa, ajuste manual e compra),
        separada por mês. O Excel gerado tem uma aba por mês.
      </p>

      {status === "loading" && <p className="text-xs text-gray-400">Carregando...</p>}
      {status === "erro" && (
        <p className="text-xs text-red-600">Não deu pra carregar a movimentação.</p>
      )}
      {status === "ready" && grupos.length === 0 && (
        <p className="text-xs text-gray-400">Nenhuma movimentação registrada ainda.</p>
      )}

      <div className="flex flex-col gap-2">
        {grupos.map((grupo, indice) => {
          const aberto = !(mesesFechados[grupo.chave] ?? indice !== 0);
          return (
            <div key={grupo.chave} className="rounded border border-gray-100">
              <button
                onClick={() => alternarMes(grupo.chave)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span className="capitalize">{grupo.label}</span>
                <span className="text-xs text-gray-400">
                  {grupo.itens.length} movimento(s) {aberto ? "▲" : "▼"}
                </span>
              </button>
              {aberto && (
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-1.5">Data</th>
                        <th className="px-3 py-1.5">Cor</th>
                        <th className="px-3 py-1.5">Tipo</th>
                        <th className="px-3 py-1.5 text-right">Gramas</th>
                        <th className="px-3 py-1.5">Detalhe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {grupo.itens.map((m, i) => (
                        <tr key={i}>
                          <td className="px-3 py-1.5 text-gray-600">
                            {new Date(m.data).toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-3 py-1.5 text-gray-700">{labelCorFilamento(m.cor)}</td>
                          <td className="px-3 py-1.5 text-gray-700">
                            {LABEL_TIPO_MOVIMENTO[m.tipo]}
                          </td>
                          <td
                            className={
                              "px-3 py-1.5 text-right font-medium " +
                              (m.gramas < 0 ? "text-red-600" : "text-green-700")
                            }
                          >
                            {m.gramas > 0 ? "+" : ""}
                            {formatGramasRelatorio(m.gramas)}g
                          </td>
                          <td className="px-3 py-1.5 text-gray-600">{m.detalhe}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RelatorioComprovantes() {
  const [status, setStatus] = useState<"loading" | "ready" | "erro">("loading");
  const [comprovantes, setComprovantes] = useState<ComprovanteResumo[]>([]);
  const [mesesFechados, setMesesFechados] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/financeiro/comprovantes");
        if (!res.ok) throw new Error("falha");
        setComprovantes(await res.json());
        setStatus("ready");
      } catch {
        setStatus("erro");
      }
    })();
  }, []);

  const grupos = useMemo(
    () => agruparPorMes(comprovantes.map((c) => ({ ...c, data: c.dataVencimento }))),
    [comprovantes]
  );

  function alternarMes(chave: string) {
    setMesesFechados((atual) => ({ ...atual, [chave]: !atual[chave] }));
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Comprovantes</h2>
      <p className="mb-3 text-xs text-gray-500">
        Documentos anexados aos lançamentos da aba Financeiro, separados por mês. Ficam sempre
        como o arquivo original (foto/PDF) — não entram no Excel, o link &quot;abrir&quot; baixa o
        arquivo de verdade.
      </p>

      {status === "loading" && <p className="text-xs text-gray-400">Carregando...</p>}
      {status === "erro" && (
        <p className="text-xs text-red-600">Não deu pra carregar os comprovantes.</p>
      )}
      {status === "ready" && grupos.length === 0 && (
        <p className="text-xs text-gray-400">Nenhum comprovante salvo ainda.</p>
      )}

      <div className="flex flex-col gap-2">
        {grupos.map((grupo, indice) => {
          const aberto = !(mesesFechados[grupo.chave] ?? indice !== 0);
          return (
            <div key={grupo.chave} className="rounded border border-gray-100">
              <button
                onClick={() => alternarMes(grupo.chave)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span className="capitalize">{grupo.label}</span>
                <span className="text-xs text-gray-400">
                  {grupo.itens.length} comprovante(s) {aberto ? "▲" : "▼"}
                </span>
              </button>
              {aberto && (
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-left uppercase text-gray-500">
                      <tr>
                        <th className="px-3 py-1.5">Data</th>
                        <th className="px-3 py-1.5">Tipo</th>
                        <th className="px-3 py-1.5">Categoria</th>
                        <th className="px-3 py-1.5">Descrição</th>
                        <th className="px-3 py-1.5">Fornecedor</th>
                        <th className="px-3 py-1.5 text-right">Valor</th>
                        <th className="px-3 py-1.5">Arquivo</th>
                        <th className="px-3 py-1.5"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {grupo.itens.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-1.5 text-gray-600">
                            {formatDiaBR(c.dataVencimento)}
                          </td>
                          <td className="px-3 py-1.5">
                            <span
                              className={
                                "rounded px-1.5 py-0.5 text-xs font-semibold " +
                                (c.tipo === "receita"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700")
                              }
                            >
                              {c.tipo === "receita" ? "Receita" : "Despesa"}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-700">{c.categoria}</td>
                          <td className="px-3 py-1.5 text-gray-600">{c.descricao || "—"}</td>
                          <td className="px-3 py-1.5 text-gray-600">{c.fornecedor || "—"}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-gray-900">
                            {formatBRLRelatorio(c.valor)}
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">{c.arquivoNome}</td>
                          <td className="px-3 py-1.5 text-right">
                            <a
                              href={`/api/financeiro/lancamentos/${c.id}/arquivo`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-medium text-blue-600 hover:underline"
                            >
                              abrir
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
