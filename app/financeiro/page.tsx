"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIAS_DESPESA,
  CATEGORIAS_RECEITA,
  FORMAS_PAGAMENTO,
  LancamentoFinanceiro,
  CompraFilamento,
} from "@/lib/financeiro";
import { CORES_FILAMENTO, labelCorFilamento } from "@/lib/placas";
import { formatDiaBR } from "@/lib/date";
import { formatGramasEmKg } from "@/lib/producao-types";

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
  formaPagamento: string | null;
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

interface RascunhoLancamento {
  tipo: "despesa" | "receita";
  categoria: string;
  descricao: string;
  valor: string;
  dataVencimento: string;
  fornecedor: string;
  formaPagamento: string;
  // À vista ou a prazo — pedido do Guilherme em 2026-07-29: "Para subir
  // lancamento de dividas ou entrada preciso colocar vendas e elas podem
  // ter prazo ou ser paga a vista e o mesmo para lancamentos de
  // fornecedores ou gastos fixos, pagamentos" — mesmo padrão já usado em
  // compras de filamento (ver novaCompra.formaPagamento abaixo). À
  // vista: dataVencimento já nasce paga na mesma data (status "pago"
  // direto). A prazo: dataVencimento é só o vencimento, nasce
  // "pendente" — marca como pago depois pelo toggle da tabela, igual já
  // funciona hoje.
  condicaoPagamento: "a_vista" | "a_prazo";
  arquivoNome?: string | null;
  arquivoMime?: string | null;
  arquivoBase64?: string | null;
}

interface ItemDividido {
  descricao: string;
  valor: string;
  categoria: string;
}

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Filamento é comprado em kg mas consumido em gramas — pedido do
// Guilherme em 2026-07-27: "Filamento compramos em kg e os produtos sao
// gramas, mas nosso controle é kg ou kg + grama". Pra evitar confusão
// com "1,36" podendo ser lido como 1,36kg=1360g (decimal comum) quando
// na real ele quer dizer 1kg+36g=1036g, o formulário usa dois campos
// separados (Kg e g) em vez de um campo só com vírgula. Aqui só formata
// o total (sempre guardado em gramas no banco) de volta pra "1kg 36g".
function formatPeso(totalGramas: number): string {
  const kg = Math.floor(totalGramas / 1000);
  const resto = Math.round(totalGramas - kg * 1000);
  if (kg === 0) return `${resto}g`;
  if (resto === 0) return `${kg}kg`;
  return `${kg}kg ${resto}g`;
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
  formaPagamento: "",
  condicaoPagamento: "a_vista",
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
  // Estoque atual de filamento (em gramas, por cor) — pedido do Guilherme
  // em 2026-07-29: "Na parte do financeiro, deve me mostrar o valor do
  // meu kg que tenho em estoque". Reusa o mesmo endpoint que a aba
  // Estoque/Produção já usa pra ler o saldo; aqui só cruza esse saldo
  // com o custo médio (por cor, ver acima) pra chegar no valor em R$
  // parado em estoque — não é só "quanto custa o kg", é "quanto vale o
  // que eu já tenho guardado".
  const [filamentoEstoque, setFilamentoEstoque] = useState<Record<string, number>>({});

  const [rascunho, setRascunho] = useState<RascunhoLancamento | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroIA, setErroIA] = useState<string | null>(null);
  const [salvandoLancamento, setSalvandoLancamento] = useState(false);
  const [categorizando, setCategorizando] = useState(false);
  const [itensDivididos, setItensDivididos] = useState<ItemDividido[] | null>(null);
  const [analisandoItens, setAnalisandoItens] = useState(false);

  // Pedido do Guilherme em 2026-07-27: "Tem que deixar eu subir mais de
  // uma cor por vez, pois eu vou subir sempre pedido inteiro" — um
  // pedido de filamento normalmente vem com várias cores juntas. Agora o
  // formulário separa: campos do PEDIDO (data, fornecedor, pagamento —
  // compartilhados) e uma "lista de itens" (cor + peso + valor, um por
  // cor), montada com "+ Adicionar" antes de salvar tudo de uma vez —
  // cada item ainda vira uma linha própria em compras_filamento (o custo
  // médio por cor continua correto).
  const [novaCompra, setNovaCompra] = useState({
    dataCompra: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10),
    fornecedor: "",
    // À vista ou a prazo — pedido: "Filamento pode ser a vista, com prazo
    // para pagamwento entao tem que conseguir coloca o prazo".
    formaPagamento: "a_vista",
    dataVencimento: "",
  });

  // Item sendo preenchido (uma cor do pedido) antes de "+ Adicionar".
  // Peso em dois campos (Kg + g) em vez de um campo decimal só — pedido
  // do Guilherme: "Filamento compramos em kg e os produtos sao gramas,
  // mas nosso controle é kg ou kg + grama, 1,36 um quilo e trinta e seis
  // gramas". Um campo só com vírgula ficaria ambíguo (1,36 poderia ser
  // lido como 1,36kg=1360g em vez de 1kg+36g=1036g).
  const [itemAtual, setItemAtual] = useState({ cor: "branco", pesoKg: "", pesoG: "", valorPago: "" });
  const [itensPedido, setItensPedido] = useState<
    { cor: string; pesoKg: string; pesoG: string; valorPago: string }[]
  >([]);
  const [salvandoCompra, setSalvandoCompra] = useState(false);

  const [mostrarComprovantes, setMostrarComprovantes] = useState(false);
  const [comprovantes, setComprovantes] = useState<ComprovanteResumo[]>([]);
  const [carregandoComprovantes, setCarregandoComprovantes] = useState(false);

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

  async function carregarFilamentoEstoque() {
    try {
      const res = await fetch("/api/producao/filamento");
      if (!res.ok) return;
      setFilamentoEstoque(await res.json());
    } catch {
      // silencioso — o bloco de valor em estoque some se não carregar
    }
  }

  useEffect(() => {
    carregarLancamentos(mes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  useEffect(() => {
    carregarCompras();
    carregarFilamentoEstoque();
  }, []);

  // Valor em R$ do filamento parado em estoque — pedido do Guilherme em
  // 2026-07-29: cruza o saldo atual (gramas por cor) com o custo médio
  // ponderado dessa cor (ou o custo médio geral, se aquela cor ainda não
  // teve nenhuma compra lançada) pra chegar em "quanto vale o que eu já
  // tenho guardado", não só "quanto custa o kg".
  const valorEstoquePorCor = useMemo(() => {
    const resultado: Record<string, number> = {};
    for (const cor of CORES_FILAMENTO) {
      const gramas = filamentoEstoque[cor] ?? 0;
      const custoPorGrama = custoMedioPorCor[cor] ?? custoMedioGeral ?? 0;
      resultado[cor] = gramas * custoPorGrama;
    }
    return resultado;
  }, [filamentoEstoque, custoMedioPorCor, custoMedioGeral]);

  const valorEstoqueTotal = useMemo(
    () => Object.values(valorEstoquePorCor).reduce((soma, v) => soma + v, 0),
    [valorEstoquePorCor]
  );

  async function carregarComprovantes() {
    setCarregandoComprovantes(true);
    try {
      const res = await fetch("/api/financeiro/comprovantes");
      if (res.ok) {
        setComprovantes(await res.json());
      }
    } finally {
      setCarregandoComprovantes(false);
    }
  }

  function alternarComprovantes() {
    const abrindo = !mostrarComprovantes;
    setMostrarComprovantes(abrindo);
    if (abrindo) carregarComprovantes();
  }

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
        formaPagamento: extraido.formaPagamento ?? "",
        // Comprovante lido pela IA normalmente já é de um pagamento
        // feito — assume à vista por padrão (Guilherme pode trocar pra
        // "a prazo" na revisão se for o caso, ex: boleto ainda não
        // pago).
        condicaoPagamento: "a_vista",
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

  // Sugestão automática de categoria — pedido do Guilherme em 2026-07-27:
  // "Categoria deve ser analisada pela Ia nao eu ter que preencher." Assim
  // que o usuário digita uma descrição no lançamento manual (e ainda não
  // escolheu categoria), a IA classifica sozinha; o campo continua
  // editável caso ela erre.
  async function sugerirCategoria(
    tipo: "despesa" | "receita",
    descricao: string,
    fornecedor: string,
    valorStr: string
  ) {
    setCategorizando(true);
    try {
      const valorNum = Number(valorStr.replace(",", "."));
      const res = await fetch("/api/financeiro/categorizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          descricao,
          fornecedor: fornecedor.trim() || null,
          valor: Number.isFinite(valorNum) ? valorNum : null,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setRascunho((atual) => {
        if (!atual) return atual;
        if (atual.categoria.trim()) return atual; // usuário já escolheu/a IA já preencheu
        if (atual.descricao.trim() !== descricao) return atual; // descrição mudou de novo nesse meio tempo
        return { ...atual, categoria: data.categoria };
      });
    } catch {
      // silencioso — categoria continua editável manualmente pelo datalist
    } finally {
      setCategorizando(false);
    }
  }

  useEffect(() => {
    if (!rascunho) return;
    if (rascunho.categoria.trim()) return;
    const descricaoAtual = rascunho.descricao.trim();
    if (descricaoAtual.length < 4) return;
    const { tipo: tipoAtual, fornecedor: fornecedorAtual, valor: valorAtual } = rascunho;
    const timer = setTimeout(() => {
      sugerirCategoria(tipoAtual, descricaoAtual, fornecedorAtual, valorAtual);
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho?.descricao, rascunho?.tipo, rascunho?.categoria]);

  // Separar descrição em itens — pedido do Guilherme em 2026-07-27: ele
  // colou uma descrição que juntava vários produtos de embalagem com
  // valores individuais (ex: "SHPP Brasil - 40,11 (Caixa papelao 18x13x9)
  // 50un -73,84 2 rolo de bolha -126,84 ...") e isso virou 1 lançamento só
  // com categoria errada. Esse botão manda o texto pra IA separar em
  // itens (descrição + valor + categoria individuais) que o usuário revisa
  // antes de salvar como vários lançamentos.
  async function analisarItens() {
    if (!rascunho) return;
    const descricao = rascunho.descricao.trim();
    if (!descricao) return;
    setAnalisandoItens(true);
    setErroIA(null);
    try {
      const valorTotalNum = Number(rascunho.valor.replace(",", "."));
      const res = await fetch("/api/financeiro/separar-itens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: rascunho.tipo,
          descricao,
          valorTotal: Number.isFinite(valorTotalNum) ? valorTotalNum : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroIA(data.error ?? "Não deu pra analisar a descrição.");
        return;
      }
      const itens = data.itens as { descricao: string; valor: number; categoria: string }[];
      if (itens.length <= 1) {
        const item = itens[0];
        if (item) {
          setRascunho((atual) =>
            atual
              ? {
                  ...atual,
                  descricao: item.descricao || atual.descricao,
                  categoria: item.categoria || atual.categoria,
                  valor: item.valor ? String(item.valor) : atual.valor,
                }
              : atual
          );
        }
        setItensDivididos(null);
      } else {
        setItensDivididos(
          itens.map((item) => ({
            descricao: item.descricao,
            valor: String(item.valor),
            categoria: item.categoria,
          }))
        );
      }
    } catch {
      setErroIA("Não deu pra conectar com a IA.");
    } finally {
      setAnalisandoItens(false);
    }
  }

  async function salvarItensDivididos() {
    if (!rascunho || !itensDivididos) return;
    setSalvandoLancamento(true);
    try {
      for (const item of itensDivididos) {
        const valorNum = Number(item.valor.replace(",", "."));
        if (!item.categoria.trim() || !Number.isFinite(valorNum) || valorNum <= 0) continue;
        await fetch("/api/financeiro/lancamentos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tipo: rascunho.tipo,
            categoria: item.categoria,
            descricao: item.descricao,
            valor: valorNum,
            dataVencimento: rascunho.dataVencimento,
            dataPagamento: rascunho.condicaoPagamento === "a_vista" ? rascunho.dataVencimento : null,
            fornecedor: rascunho.fornecedor || null,
            formaPagamento: rascunho.formaPagamento || null,
          }),
        });
      }
      setRascunho(null);
      setItensDivididos(null);
      setErroIA(null);
      await carregarLancamentos(mes);
      if (mostrarComprovantes) await carregarComprovantes();
    } finally {
      setSalvandoLancamento(false);
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
          dataPagamento: rascunho.condicaoPagamento === "a_vista" ? rascunho.dataVencimento : null,
          fornecedor: rascunho.fornecedor || null,
          formaPagamento: rascunho.formaPagamento || null,
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
        if (mostrarComprovantes) await carregarComprovantes();
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
    if (mostrarComprovantes) await carregarComprovantes();
  }

  // Kg + g somados em gramas totais (é assim que o banco guarda e que o
  // custo médio ponderado é calculado) — kg vazio conta como 0, g vazio
  // conta como 0, então dá pra comprar só em kg ("2" + "") ou só uns
  // gramas soltos ("" + "250").
  function gramasDoItem(item: { pesoKg: string; pesoG: string }): number {
    const kg = Number(item.pesoKg.replace(",", ".")) || 0;
    const g = Number(item.pesoG.replace(",", ".")) || 0;
    return kg * 1000 + g;
  }

  function adicionarItemPedido() {
    const gramas = gramasDoItem(itemAtual);
    const valorPago = Number(itemAtual.valorPago.replace(",", "."));
    if (!Number.isFinite(gramas) || gramas <= 0 || !Number.isFinite(valorPago) || valorPago <= 0) {
      return;
    }
    setItensPedido((atual) => [...atual, itemAtual]);
    setItemAtual({ cor: itemAtual.cor, pesoKg: "", pesoG: "", valorPago: "" });
  }

  function removerItemPedido(indice: number) {
    setItensPedido((atual) => atual.filter((_, i) => i !== indice));
  }

  async function salvarCompra() {
    if (itensPedido.length === 0) return;
    if (novaCompra.formaPagamento === "a_prazo" && !novaCompra.dataVencimento) {
      return;
    }
    setSalvandoCompra(true);
    try {
      for (const item of itensPedido) {
        const gramas = gramasDoItem(item);
        const valorPago = Number(item.valorPago.replace(",", "."));
        await fetch("/api/financeiro/compras-filamento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cor: item.cor,
            gramas,
            valorPago,
            dataCompra: novaCompra.dataCompra,
            fornecedor: novaCompra.fornecedor || null,
            formaPagamento: novaCompra.formaPagamento,
            dataVencimento: novaCompra.formaPagamento === "a_prazo" ? novaCompra.dataVencimento : null,
          }),
        });
      }
      setItensPedido([]);
      setNovaCompra((atual) => ({ ...atual, fornecedor: "", dataVencimento: "" }));
      await carregarCompras();
    } finally {
      setSalvandoCompra(false);
    }
  }

  async function excluirCompra(id: number) {
    await fetch(`/api/financeiro/compras-filamento/${id}`, { method: "DELETE" });
    await carregarCompras();
  }

  async function marcarStatusCompra(id: number, novoStatus: "pago" | "pendente") {
    await fetch(`/api/financeiro/compras-filamento/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus }),
    });
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
        mostrandoComprovantes={mostrarComprovantes}
        onArquivo={analisarComIA}
        onNovoManual={() => setRascunho(rascunhoVazio())}
        onAlternarComprovantes={alternarComprovantes}
      />

      {rascunho && (
        <FormularioRevisao
          rascunho={rascunho}
          salvando={salvandoLancamento}
          categorizando={categorizando}
          erro={erroIA}
          itensDivididos={itensDivididos}
          analisandoItens={analisandoItens}
          onMudar={setRascunho}
          onSalvar={salvarRascunho}
          onCancelar={() => {
            setRascunho(null);
            setItensDivididos(null);
            setErroIA(null);
          }}
          onAnalisarItens={analisarItens}
          onMudarItens={setItensDivididos}
          onSalvarItens={salvarItensDivididos}
          onCancelarItens={() => setItensDivididos(null)}
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
              <th className="px-3 py-2">Pagamento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lancamentosFiltrados.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-400">
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
                <td className="px-3 py-2 text-gray-600">{l.formaPagamento || "—"}</td>
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
        filamentoEstoque={filamentoEstoque}
        valorEstoquePorCor={valorEstoquePorCor}
        valorEstoqueTotal={valorEstoqueTotal}
        novaCompra={novaCompra}
        itemAtual={itemAtual}
        itensPedido={itensPedido}
        salvando={salvandoCompra}
        onMudar={setNovaCompra}
        onMudarItem={setItemAtual}
        onAdicionarItem={adicionarItemPedido}
        onRemoverItem={removerItemPedido}
        onSalvar={salvarCompra}
        onExcluir={excluirCompra}
        onMarcarStatus={marcarStatusCompra}
      />

      {mostrarComprovantes && (
        <ComprovantesSalvos
          comprovantes={comprovantes}
          carregando={carregandoComprovantes}
        />
      )}
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
  mostrandoComprovantes,
  onArquivo,
  onNovoManual,
  onAlternarComprovantes,
}: {
  analisando: boolean;
  erro: string | null;
  mostrandoComprovantes: boolean;
  onArquivo: (file: File) => void;
  onNovoManual: () => void;
  onAlternarComprovantes: () => void;
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
      <button
        onClick={onAlternarComprovantes}
        className={
          "rounded border px-3 py-2 text-xs font-medium " +
          (mostrandoComprovantes
            ? "border-blue-300 bg-blue-50 text-blue-700"
            : "border-gray-300 text-gray-700 hover:bg-gray-50")
        }
      >
        {mostrandoComprovantes ? "Ocultar comprovantes salvos" : "Ver comprovantes salvos"}
      </button>
      <p className="text-xs text-gray-400">
        A IA lê o documento e preenche os campos — você confirma antes de salvar.
      </p>
      {erro && <p className="w-full text-xs text-red-600">{erro}</p>}
    </div>
  );
}

function ComprovantesSalvos({
  comprovantes,
  carregando,
}: {
  comprovantes: ComprovanteResumo[];
  carregando: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="mb-1 text-sm font-semibold text-gray-700">Comprovantes salvos</p>
      <p className="mb-3 text-xs text-gray-500">
        Todos os documentos anexados a lançamentos, de qualquer mês — clique em &quot;abrir&quot;
        pra ver o arquivo original.
      </p>
      <div className="overflow-x-auto rounded border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Fornecedor</th>
              <th className="px-3 py-2">Pagamento</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Arquivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {carregando && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-gray-400">
                  Carregando...
                </td>
              </tr>
            )}
            {!carregando && comprovantes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-gray-400">
                  Nenhum comprovante salvo ainda.
                </td>
              </tr>
            )}
            {!carregando &&
              comprovantes.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 text-gray-600">{formatDiaBR(c.dataVencimento)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-xs font-semibold " +
                        (c.tipo === "receita" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")
                      }
                    >
                      {c.tipo === "receita" ? "Receita" : "Despesa"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{c.categoria}</td>
                  <td className="px-3 py-2 text-gray-600">{c.descricao || "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{c.fornecedor || "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{c.formaPagamento || "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatBRL(c.valor)}</td>
                  <td className="px-3 py-2 text-gray-500">{c.arquivoNome}</td>
                  <td className="px-3 py-2 text-right">
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
    </div>
  );
}

function FormularioRevisao({
  rascunho,
  salvando,
  categorizando,
  erro,
  itensDivididos,
  analisandoItens,
  onMudar,
  onSalvar,
  onCancelar,
  onAnalisarItens,
  onMudarItens,
  onSalvarItens,
  onCancelarItens,
}: {
  rascunho: RascunhoLancamento;
  salvando: boolean;
  categorizando: boolean;
  erro: string | null;
  itensDivididos: ItemDividido[] | null;
  analisandoItens: boolean;
  onMudar: (r: RascunhoLancamento) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  onAnalisarItens: () => void;
  onMudarItens: (itens: ItemDividido[]) => void;
  onSalvarItens: () => void;
  onCancelarItens: () => void;
}) {
  const categorias = rascunho.tipo === "despesa" ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA;
  const somaItens = itensDivididos?.reduce((acc, it) => acc + (Number(it.valor.replace(",", ".")) || 0), 0) ?? 0;

  function atualizarItem(i: number, campo: keyof ItemDividido, valor: string) {
    if (!itensDivididos) return;
    const copia = itensDivididos.slice();
    copia[i] = { ...copia[i], [campo]: valor };
    onMudarItens(copia);
  }

  function removerItem(i: number) {
    if (!itensDivididos) return;
    onMudarItens(itensDivididos.filter((_, idx) => idx !== i));
  }

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
          Categoria{" "}
          {itensDivididos ? (
            <span className="text-gray-400">(definida por item abaixo)</span>
          ) : categorizando ? (
            <span className="text-blue-500">(IA analisando...)</span>
          ) : (
            <span className="text-gray-400">(sugerida pela IA a partir da descrição)</span>
          )}
          <input
            list="categorias-financeiro"
            value={rascunho.categoria}
            onChange={(e) => onMudar({ ...rascunho, categoria: e.target.value })}
            placeholder={categorizando ? "Analisando..." : "Digite a descrição pra IA sugerir"}
            disabled={!!itensDivididos}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
          />
          <datalist id="categorias-financeiro">
            {categorias.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-gray-500">
          Valor (R$) {itensDivididos && <span className="text-gray-400">(definido por item abaixo)</span>}
          <input
            value={rascunho.valor}
            onChange={(e) => onMudar({ ...rascunho, valor: e.target.value })}
            disabled={!!itensDivididos}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
            placeholder="0,00"
          />
        </label>
        <label className="text-xs text-gray-500">
          Condição
          <select
            value={rascunho.condicaoPagamento}
            onChange={(e) =>
              onMudar({
                ...rascunho,
                condicaoPagamento: e.target.value as "a_vista" | "a_prazo",
              })
            }
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="a_vista">À vista</option>
            <option value="a_prazo">A prazo</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          {rascunho.condicaoPagamento === "a_vista" ? "Data do pagamento" : "Data de vencimento"}
          <input
            type="date"
            value={rascunho.dataVencimento}
            onChange={(e) => onMudar({ ...rascunho, dataVencimento: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Fornecedor/cliente
          <input
            value={rascunho.fornecedor}
            onChange={(e) => onMudar({ ...rascunho, fornecedor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Forma de pagamento
          <input
            list="formas-pagamento-financeiro"
            value={rascunho.formaPagamento}
            onChange={(e) => onMudar({ ...rascunho, formaPagamento: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="PIX, Boleto, Cartão..."
          />
          <datalist id="formas-pagamento-financeiro">
            {FORMAS_PAGAMENTO.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="text-xs text-gray-500 sm:col-span-3">
          Descrição (detalhe breve do que foi essa compra — se colar vários produtos/valores juntos, a
          IA consegue separar em itens)
          <textarea
            value={rascunho.descricao}
            onChange={(e) => onMudar({ ...rascunho, descricao: e.target.value })}
            rows={2}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="Ex: compra de 3 rolos de filamento PLA branco — ou cole a lista de produtos de uma compra com vários itens"
          />
        </label>
      </div>

      {!itensDivididos && (
        <button
          onClick={onAnalisarItens}
          disabled={analisandoItens || !rascunho.descricao.trim()}
          className="mt-2 rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        >
          {analisandoItens ? "Analisando descrição..." : "Separar em itens com IA"}
        </button>
      )}

      {itensDivididos && (
        <div className="mt-3 rounded border border-blue-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-gray-700">
            A IA identificou {itensDivididos.length} itens nessa descrição — revise antes de salvar
            (cada um vira um lançamento separado):
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-2 py-1">Descrição do item</th>
                  <th className="px-2 py-1">Categoria</th>
                  <th className="px-2 py-1 text-right">Valor</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itensDivididos.map((item, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <input
                        value={item.descricao}
                        onChange={(e) => atualizarItem(i, "descricao", e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        list="categorias-financeiro"
                        value={item.categoria}
                        onChange={(e) => atualizarItem(i, "categoria", e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={item.valor}
                        onChange={(e) => atualizarItem(i, "valor", e.target.value)}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        onClick={() => removerItem(i)}
                        className="text-xs text-gray-400 hover:text-red-600"
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Soma dos itens: <span className="font-medium text-gray-700">{formatBRL(somaItens)}</span>
            {rascunho.valor && Number.isFinite(Number(rascunho.valor.replace(",", "."))) && (
              <>
                {" "}
                · Valor total digitado: {formatBRL(Number(rascunho.valor.replace(",", ".")))}
                {Math.abs(somaItens - Number(rascunho.valor.replace(",", "."))) > 0.01 && (
                  <span className="ml-1 font-medium text-amber-600">(não bate — confira os valores)</span>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      <div className="mt-3 flex gap-2">
        {itensDivididos ? (
          <>
            <button
              onClick={onSalvarItens}
              disabled={salvando || itensDivididos.length === 0}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {salvando ? "Salvando..." : `Salvar ${itensDivididos.length} lançamentos`}
            </button>
            <button
              onClick={onCancelarItens}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Voltar pro lançamento único
            </button>
          </>
        ) : (
          <button
            onClick={onSalvar}
            disabled={salvando}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {salvando ? "Salvando..." : "Salvar lançamento"}
          </button>
        )}
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

interface ItemPedidoFilamento {
  cor: string;
  pesoKg: string;
  pesoG: string;
  valorPago: string;
}

function ComprasFilamento({
  compras,
  custoMedioPorCor,
  custoMedioGeral,
  filamentoEstoque,
  valorEstoquePorCor,
  valorEstoqueTotal,
  novaCompra,
  itemAtual,
  itensPedido,
  salvando,
  onMudar,
  onMudarItem,
  onAdicionarItem,
  onRemoverItem,
  onSalvar,
  onExcluir,
  onMarcarStatus,
}: {
  compras: CompraFilamento[];
  custoMedioPorCor: Record<string, number>;
  custoMedioGeral: number | null;
  filamentoEstoque: Record<string, number>;
  valorEstoquePorCor: Record<string, number>;
  valorEstoqueTotal: number;
  novaCompra: {
    dataCompra: string;
    fornecedor: string;
    formaPagamento: string;
    dataVencimento: string;
  };
  itemAtual: ItemPedidoFilamento;
  itensPedido: ItemPedidoFilamento[];
  salvando: boolean;
  onMudar: (v: typeof novaCompra) => void;
  onMudarItem: (v: ItemPedidoFilamento) => void;
  onAdicionarItem: () => void;
  onRemoverItem: (indice: number) => void;
  onSalvar: () => void;
  onExcluir: (id: number) => void;
  onMarcarStatus: (id: number, novoStatus: "pago" | "pendente") => void;
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
            <p className="text-gray-500">{labelCorFilamento(cor)}</p>
            <p className="font-semibold text-gray-800">
              {custoMedioPorCor[cor] !== undefined ? `${formatBRL(custoMedioPorCor[cor] * 1000)}/kg` : "sem dados"}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-1 flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold text-gray-700">Valor do estoque atual de filamento</p>
          <p className="text-sm font-semibold text-gray-900">{formatBRL(valorEstoqueTotal)}</p>
        </div>
        <p className="text-xs text-gray-500">
          Estoque de cada cor (aba Estoque) × custo médio dessa cor — quanto você tem parado em
          filamento hoje, em reais.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase text-gray-500">
              <tr>
                <th className="py-1 pr-3">Cor</th>
                <th className="py-1 pr-3 text-right">Estoque (Kg)</th>
                <th className="py-1 pr-3 text-right">Custo médio (R$/Kg)</th>
                <th className="py-1 text-right">Valor em estoque</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {CORES_FILAMENTO.map((cor) => {
                const custoPorGrama = custoMedioPorCor[cor] ?? custoMedioGeral ?? null;
                return (
                  <tr key={cor}>
                    <td className="py-1 pr-3 text-gray-700">{labelCorFilamento(cor)}</td>
                    <td className="py-1 pr-3 text-right text-gray-700">
                      {formatGramasEmKg(filamentoEstoque[cor] ?? 0)}
                    </td>
                    <td className="py-1 pr-3 text-right text-gray-700">
                      {custoPorGrama !== null ? formatBRL(custoPorGrama * 1000) : "sem dados"}
                    </td>
                    <td className="py-1 text-right font-medium text-gray-900">
                      {formatBRL(valorEstoquePorCor[cor] ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Um pedido pode ter várias cores — adicione cada cor abaixo e depois salve o pedido inteiro
        de uma vez (data, fornecedor e pagamento são únicos pro pedido).
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-xs text-gray-500">
          Cor
          <select
            value={itemAtual.cor}
            onChange={(e) => onMudarItem({ ...itemAtual, cor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {CORES_FILAMENTO.map((c) => (
              <option key={c} value={c}>
                {labelCorFilamento(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Peso — Kg
          <input
            value={itemAtual.pesoKg}
            onChange={(e) => onMudarItem({ ...itemAtual, pesoKg: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="1"
          />
        </label>
        <label className="text-xs text-gray-500">
          Peso — g (além do Kg)
          <input
            value={itemAtual.pesoG}
            onChange={(e) => onMudarItem({ ...itemAtual, pesoG: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="0"
          />
        </label>
        <label className="text-xs text-gray-500">
          Valor pago (R$)
          <input
            value={itemAtual.valorPago}
            onChange={(e) => onMudarItem({ ...itemAtual, valorPago: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            placeholder="0,00"
          />
        </label>
        <div className="flex items-end">
          <button
            onClick={onAdicionarItem}
            className="w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + Adicionar cor
          </button>
        </div>
      </div>

      {itensPedido.length > 0 && (
        <div className="overflow-x-auto rounded border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-1.5">Cor</th>
                <th className="px-3 py-1.5 text-right">Peso</th>
                <th className="px-3 py-1.5 text-right">Valor</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {itensPedido.map((item, i) => (
                <tr key={i}>
                  <td className="px-3 py-1.5">{labelCorFilamento(item.cor)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {formatPeso((Number(item.pesoKg.replace(",", ".")) || 0) * 1000 + (Number(item.pesoG.replace(",", ".")) || 0))}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {formatBRL(Number(item.valorPago.replace(",", ".")) || 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => onRemoverItem(i)}
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="text-xs text-gray-500">
          Data da compra
          <input
            type="date"
            value={novaCompra.dataCompra}
            onChange={(e) => onMudar({ ...novaCompra, dataCompra: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Fornecedor
          <input
            value={novaCompra.fornecedor}
            onChange={(e) => onMudar({ ...novaCompra, fornecedor: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-gray-500">
          Pagamento
          <select
            value={novaCompra.formaPagamento}
            onChange={(e) => onMudar({ ...novaCompra, formaPagamento: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="a_vista">À vista</option>
            <option value="a_prazo">A prazo</option>
          </select>
        </label>
        {novaCompra.formaPagamento === "a_prazo" && (
          <label className="text-xs text-gray-500">
            Vencimento
            <input
              type="date"
              value={novaCompra.dataVencimento}
              onChange={(e) => onMudar({ ...novaCompra, dataVencimento: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        )}
        <div className="flex items-end">
          <button
            onClick={onSalvar}
            disabled={salvando || itensPedido.length === 0}
            className="w-full rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            {salvando
              ? "Salvando..."
              : itensPedido.length > 0
              ? `Salvar pedido (${itensPedido.length} ${itensPedido.length === 1 ? "cor" : "cores"})`
              : "Salvar pedido"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-gray-100">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Cor</th>
              <th className="px-3 py-2 text-right">Peso</th>
              <th className="px-3 py-2 text-right">Valor pago</th>
              <th className="px-3 py-2 text-right">R$/kg</th>
              <th className="px-3 py-2">Fornecedor</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {compras.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-gray-400">
                  Nenhuma compra lançada ainda.
                </td>
              </tr>
            )}
            {compras.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 text-gray-600">{formatDiaBR(c.dataCompra)}</td>
                <td className="px-3 py-2">{labelCorFilamento(c.cor)}</td>
                <td className="px-3 py-2 text-right">{formatPeso(c.gramas)}</td>
                <td className="px-3 py-2 text-right">{formatBRL(c.valorPago)}</td>
                <td className="px-3 py-2 text-right">{formatBRL((c.valorPago / c.gramas) * 1000)}</td>
                <td className="px-3 py-2 text-gray-600">{c.fornecedor || "—"}</td>
                <td className="px-3 py-2 text-gray-600">{formatDiaBR(c.dataVencimento)}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onMarcarStatus(c.id, c.status === "pago" ? "pendente" : "pago")}
                    className={
                      c.status === "pago"
                        ? "rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-200"
                        : "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200"
                    }
                    title="Clique pra alternar pago/pendente"
                  >
                    {c.status === "pago" ? "Pago" : "Pendente"}
                  </button>
                </td>
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
