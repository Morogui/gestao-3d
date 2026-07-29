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

  async function registrarPerdaFilamento(
    cor: CorFilamento,
    gramas: number,
    motivo: string
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/producao/perda-filamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cor, gramas, motivo }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return body?.error ?? "não deu pra registrar a perda";
      }
      const atualizado = await res.json();
      setFilamento(atualizado);
      return null;
    } catch {
      return "não deu pra registrar a perda";
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
          &quot;Colorido&quot;.
        </p>
        {filamento && <FilamentoEditor filamento={filamento} onSalvar={salvarFilamento} />}
        <div className="mt-3">
          <PerdaFilamentoForm onRegistrar={registrarPerdaFilamento} />
        </div>
        <div className="mt-3">
          <HistoricoFilamento />
        </div>
      </section>

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

function PerdaFilamentoForm({
  onRegistrar,
}: {
  onRegistrar: (cor: CorFilamento, gramas: number, motivo: string) => Promise<string | null>;
}) {
  const [cor, setCor] = useState<CorFilamento>("colorido");
  const [gramas, setGramas] = useState("");
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  async function registrar() {
    const valor = Number(gramas);
    if (!valor || valor <= 0) {
      setErro("informe uma quantidade em gramas maior que 0");
      return;
    }
    setSalvando(true);
    setErro(null);
    setSucesso(false);
    try {
      const resultado = await onRegistrar(cor, valor, motivo.trim());
      if (resultado) {
        setErro(resultado);
      } else {
        setGramas("");
        setMotivo("");
        setSucesso(true);
        setTimeout(() => setSucesso(false), 3000);
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-gray-700">Registrar perda avulsa de filamento</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Cor</span>
          <select
            value={cor}
            onChange={(e) => setCor(e.target.value as CorFilamento)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {CORES_FILAMENTO.map((c) => (
              <option key={c} value={c}>
                {LABEL_COR_FILAMENTO[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Gramas</span>
          <input
            type="number"
            min={0}
            value={gramas}
            onChange={(e) => setGramas(e.target.value)}
            className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Motivo (opcional)</span>
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="ex: rolo estragado, teste de cor..."
            className="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={registrar}
          disabled={salvando}
          className="rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {salvando ? "Registrando..." : "Registrar perda"}
        </button>
      </div>
      {erro && <p className="mt-1 text-xs text-red-600">{erro}</p>}
      {sucesso && <p className="mt-1 text-xs text-green-700">Perda registrada.</p>}
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
