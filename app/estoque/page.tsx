"use client";

import { useEffect, useMemo, useState } from "react";
import { PlacaRow, CORES_FILAMENTO, CorFilamento } from "@/lib/placas";
import { EstoqueFilamentoRow } from "@/lib/producao-types";

type EstoqueRow = PlacaRow & { atualizadoEm: string | null };
type Status = "loading" | "ready" | "erro";

interface Movimento {
  data: string;
  tipo: "venda" | "producao" | "manual" | "full";
  quantidade: number;
  detalhe: string;
}

interface SincronizacaoInfo {
  connected: boolean;
  pedidosVerificados?: number;
  combosNovos?: number;
  pecasBaixadas?: number;
  combosRevertidos?: number;
  pecasDevolvidas?: number;
}

// Aba Estoque: lista todas as placas (inclusive descontinuadas, como a
// Taça Copa do Mundo — não produzimos mais, mas ainda vende o que
// sobrou) com um campo de ajuste manual. O ajuste escreve direto na
// mesma tabela estoque_placas que a aba Produção lê/credita — então as
// duas telas ficam sempre em sincronia, sem ledger paralelo.
//
// Além do ajuste manual, toda vez que essa aba é aberta ela também
// dispara a sincronização automática de vendas — verifica pedidos
// recentes da ML/Shopee e desconta do estoque os que já contam como
// "vendido" (pago), sem precisar de ajuste manual pra cada venda. Mudou
// em 2026-07-24 (pedido do Guilherme: "produto vendido tem que ter em
// estoque e ser dado baixa quando aparecer em vendido") — antes só
// descontava quando o pedido aparecia como ENVIADO, o que atrasava o
// número em relação à realidade e confundia a produção. Se um pedido já
// descontado for cancelado/estornado depois, a peça volta sozinha (ver
// combosRevertidos/pecasDevolvidas abaixo).
export default function EstoquePage() {
  const [status, setStatus] = useState<Status>("loading");
  const [placas, setPlacas] = useState<EstoqueRow[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<Record<number, boolean>>({});
  const [sincronizando, setSincronizando] = useState(false);
  const [sincronizacao, setSincronizacao] = useState<SincronizacaoInfo | null>(null);
  const [filamento, setFilamento] = useState<EstoqueFilamentoRow | null>(null);

  async function carregarFilamento() {
    try {
      const res = await fetch("/api/producao/filamento");
      if (!res.ok) throw new Error("falha");
      setFilamento(await res.json());
    } catch {
      // silencioso — o card some se não carregar, mas não trava a tela
    }
  }

  async function salvarFilamento(novo: EstoqueFilamentoRow) {
    const res = await fetch("/api/producao/filamento", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(novo),
    });
    if (res.ok) {
      setFilamento(await res.json());
    }
  }

  // Pedido de compra de filamento — abre uma janela (modal) onde dá pra
  // lançar o pedido inteiro de uma vez: uma ou mais cores (cada uma com
  // peso e valor), fornecedor, e a data de pagamento — com um botão "+"
  // pra revelar o campo de vencimento só quando o pedido tem prazo (por
  // padrão assume à vista, pago na própria data da compra). Pedido do
  // Guilherme em 2026-07-29: "Para adicionar filamentos, deve ter um
  // campo onde abra uma janela... Apos ser lançado ele gera demanda para
  // a aba do financeiro". Cada cor vira uma linha em compras_filamento
  // (soma o estoque_filamento e alimenta o custo médio, ver
  // /api/financeiro/compras-filamento) e o pedido inteiro também vira UM
  // lançamento em financeiro_lancamentos (categoria "Filamento", valor =
  // soma de todas as cores) pra aparecer no calendário/resumo/despesas
  // pendentes da aba Financeiro — antes só entrava no estoque, sem gerar
  // essa "demanda" financeira.
  const hojeISO = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [modalAdicionarAberto, setModalAdicionarAberto] = useState(false);
  const [itemPedidoAtual, setItemPedidoAtual] = useState({
    cor: "colorido" as CorFilamento,
    pesoKg: "",
    pesoG: "",
    valorPago: "",
  });
  const [itensPedidoFilamento, setItensPedidoFilamento] = useState<
    { cor: CorFilamento; pesoKg: string; pesoG: string; valorPago: string }[]
  >([]);
  const [pedidoFilamento, setPedidoFilamento] = useState({
    dataCompra: hojeISO(),
    fornecedor: "",
    temPrazo: false,
    dataVencimento: "",
  });
  const [salvandoPedido, setSalvandoPedido] = useState(false);
  const [erroPedido, setErroPedido] = useState<string | null>(null);

  function gramasDoItemPedido(item: { pesoKg: string; pesoG: string }): number {
    const kg = Number(item.pesoKg.replace(",", ".")) || 0;
    const g = Number(item.pesoG.replace(",", ".")) || 0;
    return kg * 1000 + g;
  }

  function formatPesoPedido(totalGramas: number): string {
    const kg = Math.floor(totalGramas / 1000);
    const resto = Math.round(totalGramas - kg * 1000);
    if (kg === 0) return `${resto}g`;
    if (resto === 0) return `${kg}kg`;
    return `${kg}kg ${resto}g`;
  }

  function adicionarItemPedidoFilamento() {
    const gramas = gramasDoItemPedido(itemPedidoAtual);
    const valorPago = Number(itemPedidoAtual.valorPago.replace(",", "."));
    if (!Number.isFinite(gramas) || gramas <= 0 || !Number.isFinite(valorPago) || valorPago <= 0) {
      return;
    }
    setItensPedidoFilamento((atual) => [...atual, itemPedidoAtual]);
    setItemPedidoAtual({ cor: itemPedidoAtual.cor, pesoKg: "", pesoG: "", valorPago: "" });
  }

  function removerItemPedidoFilamento(indice: number) {
    setItensPedidoFilamento((atual) => atual.filter((_, i) => i !== indice));
  }

  function fecharModalAdicionar() {
    setModalAdicionarAberto(false);
    setErroPedido(null);
    setItensPedidoFilamento([]);
    setItemPedidoAtual({ cor: "colorido", pesoKg: "", pesoG: "", valorPago: "" });
    setPedidoFilamento({ dataCompra: hojeISO(), fornecedor: "", temPrazo: false, dataVencimento: "" });
  }

  const totalPedidoFilamento = itensPedidoFilamento.reduce(
    (soma, item) => soma + (Number(item.valorPago.replace(",", ".")) || 0),
    0
  );

  async function salvarPedidoFilamento() {
    if (itensPedidoFilamento.length === 0) {
      setErroPedido("Adicione pelo menos uma cor ao pedido.");
      return;
    }
    if (pedidoFilamento.temPrazo && !pedidoFilamento.dataVencimento) {
      setErroPedido("Informe o vencimento do prazo.");
      return;
    }
    setSalvandoPedido(true);
    setErroPedido(null);
    try {
      for (const item of itensPedidoFilamento) {
        const gramas = gramasDoItemPedido(item);
        const valorPago = Number(item.valorPago.replace(",", "."));
        const res = await fetch("/api/financeiro/compras-filamento", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cor: item.cor,
            gramas,
            valorPago,
            dataCompra: pedidoFilamento.dataCompra,
            fornecedor: pedidoFilamento.fornecedor || null,
            formaPagamento: pedidoFilamento.temPrazo ? "a_prazo" : "a_vista",
            dataVencimento: pedidoFilamento.temPrazo ? pedidoFilamento.dataVencimento : null,
          }),
        });
        if (!res.ok) throw new Error("falha ao salvar compra");
      }

      const resumoItens = itensPedidoFilamento
        .map((it) => `${LABEL_COR_FILAMENTO[it.cor]} ${formatPesoPedido(gramasDoItemPedido(it))}`)
        .join(", ");
      await fetch("/api/financeiro/lancamentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo: "despesa",
          categoria: "Filamento",
          descricao: `Compra de filamento — ${resumoItens}`,
          valor: totalPedidoFilamento,
          dataVencimento: pedidoFilamento.temPrazo
            ? pedidoFilamento.dataVencimento
            : pedidoFilamento.dataCompra,
          dataPagamento: pedidoFilamento.temPrazo ? null : pedidoFilamento.dataCompra,
          fornecedor: pedidoFilamento.fornecedor || null,
          formaPagamento: pedidoFilamento.temPrazo ? "A prazo" : "À vista",
        }),
      });

      await carregarFilamento();
      fecharModalAdicionar();
    } catch {
      setErroPedido("Não deu pra salvar o pedido. Tente de novo.");
    } finally {
      setSalvandoPedido(false);
    }
  }

  async function carregar() {
    try {
      const res = await fetch("/api/estoque");
      if (!res.ok) throw new Error("falha");
      setPlacas(await res.json());
      setStatus("ready");
    } catch {
      setStatus("erro");
    }
  }

  async function sincronizarVendas() {
    setSincronizando(true);
    try {
      const res = await fetch("/api/estoque/sincronizar-vendas", { method: "POST" });
      const info = (await res.json()) as SincronizacaoInfo;
      setSincronizacao(info);
      if (info.connected && ((info.combosNovos ?? 0) > 0 || (info.combosRevertidos ?? 0) > 0)) {
        await carregar();
      }
    } catch {
      setSincronizacao({ connected: false });
    } finally {
      setSincronizando(false);
    }
  }

  useEffect(() => {
    carregar();
    sincronizarVendas();
    carregarFilamento();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return placas;
    return placas.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        p.skuOuKit.toLowerCase().includes(termo)
    );
  }, [placas, busca]);

  async function ajustarEstoque(placaId: number, delta: number) {
    if (!delta) return;
    setSalvando((prev) => ({ ...prev, [placaId]: true }));
    try {
      const res = await fetch("/api/estoque", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placaId, delta }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setPlacas((prev) =>
          prev.map((p) =>
            p.id === placaId
              ? { ...p, estoque: atualizado.quantidade_pecas, atualizadoEm: atualizado.atualizado_em }
              : p
          )
        );
      }
    } finally {
      setSalvando((prev) => ({ ...prev, [placaId]: false }));
    }
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando estoque...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar o estoque. Tente recarregar a página.
      </div>
    );
  }

  const totalPecas = placasFiltradas.reduce((soma, p) => soma + p.estoque, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card label="Placas cadastradas" value={String(placas.length)} />
        <Card
          label="Descontinuadas (só vender estoque)"
          value={String(placas.filter((p) => p.descontinuada).length)}
        />
        <Card label="Total de peças em estoque" value={String(totalPecas)} />
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">Estoque de filamento por cor</h2>
        <p className="mb-3 text-xs text-gray-500">
          Informe o quanto tem em estoque de cada cor (em gramas). Cor deixada
          em 0 bloqueia automaticamente a fila de prioridade da aba Produção
          pra todas as placas daquela cor — não precisa subir produto pra
          produção sem ter filamento pra imprimir. A cor de cada placa é
          detectada pelo nome (ex: &quot;Suporte Carro (Prata)&quot;); placas
          sem cor no nome (kits, produtos multicoloridos) contam como
          &quot;Colorido&quot;. Pra registrar perda avulsa, use a aba Produção.
        </p>
        {filamento && <FilamentoEditor filamento={filamento} onSalvar={salvarFilamento} />}
        <div className="mt-3">
          <button
            onClick={() => setModalAdicionarAberto(true)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + Adicionar filamento
          </button>
        </div>
        <div className="mt-3">
          <HistoricoFilamento />
        </div>
      </section>

      {modalAdicionarAberto && (
        <ModalAdicionarFilamento
          itemAtual={itemPedidoAtual}
          itensPedido={itensPedidoFilamento}
          pedido={pedidoFilamento}
          total={totalPedidoFilamento}
          salvando={salvandoPedido}
          erro={erroPedido}
          onMudarItem={setItemPedidoAtual}
          onAdicionarItem={adicionarItemPedidoFilamento}
          onRemoverItem={removerItemPedidoFilamento}
          onMudarPedido={setPedidoFilamento}
          onSalvar={salvarPedidoFilamento}
          onFechar={fecharModalAdicionar}
          formatPeso={formatPesoPedido}
          gramasDoItem={gramasDoItemPedido}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm">
        <button
          onClick={sincronizarVendas}
          disabled={sincronizando}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {sincronizando ? "Sincronizando..." : "Sincronizar vendas agora"}
        </button>
        {sincronizacao && !sincronizacao.connected && (
          <span className="text-xs text-red-600">
            Não deu pra sincronizar — ML e Shopee parecem desconectados.
            Reconecte na aba Vendas.
          </span>
        )}
        {sincronizacao && sincronizacao.connected && (
          <span className="text-xs text-gray-500">
            {sincronizacao.pedidosVerificados ?? 0} pedido(s) vendido(s)
            verificado(s) (últimos {10} dias) ·{" "}
            <span className="font-medium text-gray-700">
              {sincronizacao.combosNovos ?? 0} baixa(s) nova(s)
            </span>{" "}
            · {sincronizacao.pecasBaixadas ?? 0} peça(s) descontada(s) agora
            {(sincronizacao.combosRevertidos ?? 0) > 0 && (
              <>
                {" "}
                ·{" "}
                <span className="font-medium text-amber-700">
                  {sincronizacao.combosRevertidos} pedido(s) cancelado(s)/estornado(s)
                </span>{" "}
                devolveram {sincronizacao.pecasDevolvidas ?? 0} peça(s) ao estoque
              </>
            )}
            .
          </span>
        )}
      </div>
      <p className="-mt-4 text-xs text-gray-400">
        A baixa automática desconta pedidos assim que contam como
        &quot;vendido&quot; pela API (ML: pago/parcialmente pago; Shopee:
        qualquer status exceto não pago/cancelado) — não espera o envio.
        Se um pedido já descontado for cancelado ou estornado depois, a
        peça volta pro estoque sozinha na próxima sincronização. Ela roda
        sozinha sempre que essa aba é aberta, e você também pode forçar
        com o botão acima. Cada pedido só é descontado uma vez, mesmo
        rodando várias vezes.
      </p>

      <div>
        <input
          type="text"
          placeholder="Buscar por nome ou SKU..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <p className="text-xs text-gray-500">
        O ajuste manual soma (ou subtrai, se você digitar um número
        negativo) ao estoque atual da placa — grava direto na mesma tabela
        que a aba Produção usa, então o número aparece igual nas duas
        telas.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2 text-right">Estoque atual</th>
              <th className="px-3 py-2">Ajuste manual</th>
              <th className="px-3 py-2">Atualizado em</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {placasFiltradas.map((placa) => (
              <LinhaEstoque
                key={placa.id}
                placa={placa}
                salvando={Boolean(salvando[placa.id])}
                onAjustar={(delta) => ajustarEstoque(placa.id, delta)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function TierBadge({ tier }: { tier: "A" | "B" | "C" }) {
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-xs font-semibold " +
        (tier === "A"
          ? "bg-green-100 text-green-700"
          : tier === "B"
          ? "bg-blue-100 text-blue-700"
          : "bg-gray-100 text-gray-600")
      }
    >
      {tier}
    </span>
  );
}

function LinhaEstoque({
  placa,
  salvando,
  onAjustar,
}: {
  placa: EstoqueRow;
  salvando: boolean;
  onAjustar: (delta: number) => void;
}) {
  const [valor, setValor] = useState("");
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState<Movimento[] | "loading" | "erro" | null>(
    null
  );

  async function alternarHistorico() {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (historico === null) {
      setHistorico("loading");
      try {
        const res = await fetch(`/api/estoque/${placa.id}/historico`);
        if (!res.ok) throw new Error("falha");
        const data = await res.json();
        setHistorico(data.movimentos);
      } catch {
        setHistorico("erro");
      }
    }
  }

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-3 py-2">
          {/* SKU em cima (negrito) — é o código/descrição real do produto
              (ex: "STAM-01 BEGE | Suporte Organizador..."), o que o
              Guilherme usa pra identificar o item de verdade. O nome
              "amigável" vira legenda embaixo (pedido 2026-07-23: "aqui
              sempre temos que ter a sku nao o nome"). */}
          <p className="font-medium text-gray-900">
            {placa.skuOuKit}
            {placa.descontinuada && (
              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500">
                Descontinuada
              </span>
            )}
          </p>
          <p className="text-xs text-gray-400">
            {placa.nome}
            {placa.tipo === "composto" ? ` · ${placa.papel} de ${placa.grupoComposto}` : ""}
          </p>
        </td>
        <td className="px-3 py-2">
          <TierBadge tier={placa.tier} />
        </td>
        <td className="px-3 py-2 text-right font-semibold text-gray-900">{placa.estoque}</td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              placeholder="+/- qtd"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-xs"
            />
            <button
              disabled={salvando || !valor || Number(valor) === 0}
              onClick={() => {
                onAjustar(Number(valor));
                setValor("");
              }}
              className="rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              Aplicar
            </button>
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-gray-400">
          {placa.atualizadoEm ? new Date(placa.atualizadoEm).toLocaleString("pt-BR") : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={alternarHistorico}
            className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline"
          >
            {aberto ? "Fechar" : "Ver histórico"}
          </button>
        </td>
      </tr>
      {aberto && (
        <tr>
          <td colSpan={6} className="bg-gray-50 px-3 py-3">
            <HistoricoMovimentacao historico={historico} />
          </td>
        </tr>
      )}
    </>
  );
}

// Histórico de movimentação — pedido do Guilherme em 2026-07-24: ele
// perguntou "de onde tirou esses 37" sobre um número de estoque, e não
// tinha como responder além de "é o total atual". Junta as 3 fontes que
// mexem no estoque (venda automática, produção concluída, ajuste manual)
// numa única linha do tempo por placa — ver /api/estoque/[placaId]/historico.
function HistoricoMovimentacao({
  historico,
}: {
  historico: Movimento[] | "loading" | "erro" | null;
}) {
  if (historico === "loading" || historico === null) {
    return <p className="text-xs text-gray-400">Carregando histórico...</p>;
  }
  if (historico === "erro") {
    return <p className="text-xs text-red-600">Não deu pra carregar o histórico.</p>;
  }
  if (historico.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        Nenhuma movimentação registrada ainda pra essa placa (o valor atual pode vir de
        antes desse histórico existir).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full max-w-2xl text-xs">
        <thead className="text-left uppercase text-gray-400">
          <tr>
            <th className="py-1 pr-3">Quando</th>
            <th className="py-1 pr-3">Origem</th>
            <th className="py-1 pr-3 text-right">Qtd</th>
            <th className="py-1">Detalhe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {historico.map((m, i) => (
            <tr key={i}>
              <td className="py-1 pr-3 whitespace-nowrap text-gray-500">
                {new Date(m.data).toLocaleString("pt-BR")}
              </td>
              <td className="py-1 pr-3">
                <OrigemBadge tipo={m.tipo} />
              </td>
              <td
                className={
                  "py-1 pr-3 text-right font-medium " +
                  (m.quantidade > 0 ? "text-green-700" : "text-red-600")
                }
              >
                {m.quantidade > 0 ? `+${m.quantidade}` : m.quantidade}
              </td>
              <td className="py-1 text-gray-600">{m.detalhe}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrigemBadge({ tipo }: { tipo: Movimento["tipo"] }) {
  const estilos =
    tipo === "venda"
      ? "bg-red-100 text-red-700"
      : tipo === "producao"
      ? "bg-green-100 text-green-700"
      : tipo === "full"
      ? "bg-purple-100 text-purple-700"
      : "bg-amber-100 text-amber-700";
  const rotulo =
    tipo === "venda"
      ? "Venda"
      : tipo === "producao"
      ? "Produção"
      : tipo === "full"
      ? "Envio Full"
      : "Manual";
  return (
    <span className={"rounded px-1.5 py-0.5 text-xs font-semibold " + estilos}>
      {rotulo}
    </span>
  );
}

// --- Estoque de filamento — movido da aba Produção em 2026-07-28, pedido
// do Guilherme: "Na aba de producao devemos ter um campo onde mostre o
// quanto de filamento temos em estoque isso deve ser em tempo real com o
// que a gente for dando baixa em producao. O Estoque do filamento deve
// ser controlado em estoque." Produção agora só mostra o saldo em modo
// leitura; toda a edição (salvar estoque, registrar perda, ver
// histórico) vive aqui. ---

const LABEL_COR_FILAMENTO: Record<CorFilamento, string> = {
  colorido: "Colorido",
  preto: "Preto",
  branco: "Branco",
  prata: "Prata",
  marrom: "Marrom",
  bege: "Bege",
};

function FilamentoEditor({
  filamento,
  onSalvar,
}: {
  filamento: EstoqueFilamentoRow;
  onSalvar: (novo: EstoqueFilamentoRow) => void;
}) {
  const [valores, setValores] = useState<Record<CorFilamento, string>>(() => {
    const inicial = {} as Record<CorFilamento, string>;
    for (const cor of CORES_FILAMENTO) {
      inicial[cor] = String(filamento[cor] ?? 0);
    }
    return inicial;
  });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const novo = {} as Record<CorFilamento, string>;
    for (const cor of CORES_FILAMENTO) {
      novo[cor] = String(filamento[cor] ?? 0);
    }
    setValores(novo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filamento]);

  async function salvar() {
    setSalvando(true);
    try {
      const novo = {} as EstoqueFilamentoRow;
      for (const cor of CORES_FILAMENTO) {
        novo[cor] = Math.max(0, Number(valores[cor]) || 0);
      }
      await onSalvar(novo);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        {CORES_FILAMENTO.map((cor) => {
          const zerado = (Number(valores[cor]) || 0) <= 0;
          return (
            <label key={cor} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">{LABEL_COR_FILAMENTO[cor]}</span>
              <input
                type="number"
                min={0}
                value={valores[cor]}
                onChange={(e) => setValores((prev) => ({ ...prev, [cor]: e.target.value }))}
                className={
                  "rounded border px-2 py-1.5 text-sm " +
                  (zerado ? "border-red-300 bg-red-50 text-red-700" : "border-gray-300")
                }
              />
            </label>
          );
        })}
      </div>
      <button
        onClick={salvar}
        disabled={salvando}
        className="mt-3 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar estoque de filamento"}
      </button>
    </div>
  );
}

interface ItemPedidoFilamentoEstoque {
  cor: CorFilamento;
  pesoKg: string;
  pesoG: string;
  valorPago: string;
}

function formatBRLEstoque(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Janela de "novo pedido de filamento" — pedido do Guilherme em
// 2026-07-29: "Para adicionar filamentos, deve ter um campo onde abra
// uma janela, e eu consiga colocar os filamentos que quero adicionar,
// total do pedido, janela para colocar data de pagamento, podendo ter
// prazo entao deve ter um botao de + para colocar prazo caso tiver".
// Um pedido pode trazer várias cores juntas — cada cor vira um item da
// lista (com peso em Kg+g e valor) antes de "Salvar pedido"; por padrão
// assume à vista (pago na data da compra) e o botão "+ Adicionar prazo"
// revela o campo de vencimento só quando o pagamento não é imediato.
function ModalAdicionarFilamento({
  itemAtual,
  itensPedido,
  pedido,
  total,
  salvando,
  erro,
  onMudarItem,
  onAdicionarItem,
  onRemoverItem,
  onMudarPedido,
  onSalvar,
  onFechar,
  formatPeso,
  gramasDoItem,
}: {
  itemAtual: ItemPedidoFilamentoEstoque;
  itensPedido: ItemPedidoFilamentoEstoque[];
  pedido: { dataCompra: string; fornecedor: string; temPrazo: boolean; dataVencimento: string };
  total: number;
  salvando: boolean;
  erro: string | null;
  onMudarItem: (v: ItemPedidoFilamentoEstoque) => void;
  onAdicionarItem: () => void;
  onRemoverItem: (indice: number) => void;
  onMudarPedido: (v: { dataCompra: string; fornecedor: string; temPrazo: boolean; dataVencimento: string }) => void;
  onSalvar: () => void;
  onFechar: () => void;
  formatPeso: (gramas: number) => string;
  gramasDoItem: (item: { pesoKg: string; pesoG: string }) => number;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Adicionar filamento — novo pedido</h3>
          <button onClick={onFechar} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Um pedido pode ter várias cores — adicione cada uma abaixo e depois salve o pedido inteiro
          de uma vez. Isso soma direto no estoque de cada cor e também lança a despesa na aba
          Financeiro.
        </p>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <label className="text-xs text-gray-500">
            Cor
            <select
              value={itemAtual.cor}
              onChange={(e) => onMudarItem({ ...itemAtual, cor: e.target.value as CorFilamento })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              {CORES_FILAMENTO.map((c) => (
                <option key={c} value={c}>
                  {LABEL_COR_FILAMENTO[c]}
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
          <div className="mt-3 overflow-x-auto rounded border border-gray-100">
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
                    <td className="px-3 py-1.5">{LABEL_COR_FILAMENTO[item.cor]}</td>
                    <td className="px-3 py-1.5 text-right">{formatPeso(gramasDoItem(item))}</td>
                    <td className="px-3 py-1.5 text-right">
                      {formatBRLEstoque(Number(item.valorPago.replace(",", ".")) || 0)}
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

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-500">
            Fornecedor
            <input
              value={pedido.fornecedor}
              onChange={(e) => onMudarPedido({ ...pedido, fornecedor: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            {pedido.temPrazo ? "Data da compra" : "Data de pagamento"}
            <input
              type="date"
              value={pedido.dataCompra}
              onChange={(e) => onMudarPedido({ ...pedido, dataCompra: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="mt-2">
          {!pedido.temPrazo ? (
            <button
              onClick={() => onMudarPedido({ ...pedido, temPrazo: true })}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              + Adicionar prazo (pagamento não é à vista)
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-gray-500">
                Vencimento (a prazo)
                <input
                  type="date"
                  value={pedido.dataVencimento}
                  onChange={(e) => onMudarPedido({ ...pedido, dataVencimento: e.target.value })}
                  className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              </label>
              <button
                onClick={() => onMudarPedido({ ...pedido, temPrazo: false, dataVencimento: "" })}
                className="text-xs text-gray-400 hover:text-red-600"
              >
                remover prazo (voltar pra à vista)
              </button>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-700">
            Total do pedido: <span className="font-semibold">{formatBRLEstoque(total)}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={onFechar}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={onSalvar}
              disabled={salvando || itensPedido.length === 0}
              className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {salvando ? "Salvando..." : "Salvar pedido"}
            </button>
          </div>
        </div>
        {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      </div>
    </div>
  );
}

interface MovimentoFilamento {
  data: string;
  cor: string;
  tipo: "producao" | "falha" | "perda_avulsa" | "ajuste_manual" | "compra";
  gramas: number;
  detalhe: string;
}

const LABEL_TIPO_MOVIMENTO_FILAMENTO: Record<MovimentoFilamento["tipo"], string> = {
  producao: "Produção concluída",
  falha: "Falha na placa",
  perda_avulsa: "Perda avulsa",
  ajuste_manual: "Ajuste manual",
  compra: "Compra (Financeiro)",
};

function HistoricoFilamento() {
  const [aberto, setAberto] = useState(false);
  const [movimentos, setMovimentos] = useState<MovimentoFilamento[] | "loading" | "erro" | null>(null);

  async function alternar() {
    if (!aberto && movimentos === null) {
      setMovimentos("loading");
      try {
        const res = await fetch("/api/producao/filamento/historico");
        if (!res.ok) throw new Error("falha");
        const data = await res.json();
        setMovimentos(data.movimentos ?? []);
      } catch {
        setMovimentos("erro");
      }
    }
    setAberto((prev) => !prev);
  }

  return (
    <div>
      <button
        onClick={alternar}
        className="text-xs font-medium text-blue-600 hover:underline"
      >
        {aberto ? "Fechar histórico" : "Ver histórico de movimentação"}
      </button>
      {aberto && (
        <div className="mt-2 overflow-x-auto">
          {movimentos === "loading" || movimentos === null ? (
            <p className="text-xs text-gray-400">Carregando histórico...</p>
          ) : movimentos === "erro" ? (
            <p className="text-xs text-red-600">Não deu pra carregar o histórico.</p>
          ) : movimentos.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma movimentação registrada ainda.</p>
          ) : (
            <table className="w-full max-w-3xl text-xs">
              <thead className="text-left uppercase text-gray-400">
                <tr>
                  <th className="py-1 pr-3">Quando</th>
                  <th className="py-1 pr-3">Cor</th>
                  <th className="py-1 pr-3">Origem</th>
                  <th className="py-1 pr-3 text-right">Gramas</th>
                  <th className="py-1">Detalhe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {movimentos.map((m, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-3 whitespace-nowrap text-gray-500">
                      {new Date(m.data).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-1 pr-3">{LABEL_COR_FILAMENTO[m.cor as CorFilamento] ?? m.cor}</td>
                    <td className="py-1 pr-3">{LABEL_TIPO_MOVIMENTO_FILAMENTO[m.tipo]}</td>
                    <td
                      className={
                        "py-1 pr-3 text-right font-medium " +
                        (m.gramas > 0 ? "text-green-700" : "text-red-600")
                      }
                    >
                      {m.gramas > 0 ? `+${m.gramas}` : m.gramas}g
                    </td>
                    <td className="py-1 text-gray-600">{m.detalhe}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
