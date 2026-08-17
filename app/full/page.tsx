"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDiaBR, todaySP } from "@/lib/date";

type Status = "loading" | "ready" | "erro" | "desconectado";

// Uma linha por SKU real vendido no Full na semana (pedido do Guilherme
// em 2026-07-25: "deve mostrar por sku... precisamos por sku certinho").
// Placas sem venda no Full na semana aparecem com 1 linha usando o SKU
// cadastrado no catálogo, já que não tem venda recente pra descobrir o
// SKU real da ML.
interface LinhaFull {
  chave: string;
  placaId: number;
  numero: number;
  nome: string;
  tier: "A" | "B" | "C";
  sku: string;
  titulo: string;
  estoqueLocal: number;
  vendidoFull7d: number;
  estoqueFullAtual: number;
  fonteEstoqueFull: "api" | "manual";
  atualizadoEm: string | null;
  recomendacaoEnvio: number;
  // Multiplicador do SKU (kits) — pedido do Guilherme em 2026-08-07,
  // pra "Agendar Full" saber criar o envio certo direto (mesmo campo já
  // usado em full_envios.pecas_por_unidade).
  pecasPorUnidade: number;
}

interface SkuResult {
  sku: string;
  placa_id: number;
  pecas_por_unidade: string;
  placa_nome: string;
  placa_numero: number;
  variacoes: number;
}

// Envio planejado do Full — data limite pra enviar + SKU + quantidade.
// Pedido do Guilherme em 2026-07-25: "uma aba onde vou subir meu envio
// e a data que eu tenho para enviar esse produto... valida em estoque
// se tenho a quantidade... se não tiver, gera uma ordem de produção
// extraordinária de prioridade". faltantePlaca > 0 é exatamente esse
// alerta — e é o mesmo valor que a aba Produção usa pra furar a fila.
interface EnvioFull {
  id: number;
  sku: string;
  placaId: number;
  placaNome: string;
  quantidade: number;
  dataLimite: string;
  status: "pendente" | "confirmado" | "cancelado";
  criadoEm: string;
  confirmadoEm: string | null;
  faltantePlaca: number;
  horasNecessarias: number;
  capacidadeDisponivelHoras: number;
  percentualComprometido: number;
  aprovado: boolean;
  grupoId: string | null;
  pecasPorUnidade: number;
  tituloMl?: string | null;
}

// Grupo pronto pra revisar no painel "Agendar Full" — pedido do
// Guilherme em 2026-08-07: "quando clicado no botão, devo colocar qual
// produto vou enviar, conforme você me recomendar e confirmar a
// quantidade... tomar cuidado com produtos com parafuso e sem, a
// recomendação tem que ser conforme o SKU vendido". Cada grupo já é um
// SKU real (igual às linhas da tabela principal); produtos compostos
// (corpo+gancho) juntam as placas componentes num só placaIds[], igual
// já acontece em "Adicionar envio" manual.
interface GrupoAgendamento {
  chaveGrupo: string;
  sku: string;
  nome: string;
  // Texto real do anúncio da ML que gerou essa recomendação — pedido do
  // Guilherme em 2026-08-08: quando uma placa tem mais de 1 SKU real
  // vendido (ex: Cortina Com Parafuso x Sem Parafuso), os grupos ficavam
  // com o MESMO rótulo genérico (nome da placa) na tela de agendar,
  // impossível de diferenciar qual linha é qual SKU. Mostrado como
  // "Anúncio ML: ..." no painel, igual já faz a tabela principal da aba.
  titulo: string;
  placaIds: number[];
  pecasPorUnidade: Record<number, number>;
  vendidoFull7d: number;
  recomendado: number;
}

export default function FullPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [linhas, setLinhas] = useState<LinhaFull[]>([]);
  const [periodo, setPeriodo] = useState<{ inicio: string; fim: string } | null>(null);
  const [apiDisponivel, setApiDisponivel] = useState(false);
  const [userProductSeller, setUserProductSeller] = useState<boolean | null>(null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<Record<string, boolean>>({});
  const [envios, setEnvios] = useState<EnvioFull[]>([]);
  // Multiplicador de envio (vendido × X) — pedido do Guilherme em
  // 2026-08-07: "o envio do full funciona todo produto vendido x 1.3
  // (esse valor temos que ter um campo para alterar)". Ver
  // /api/full/config e recomendacaoEnvio em /api/estoque-full.
  const [multiplicador, setMultiplicador] = useState(1.3);
  const [multiplicadorInput, setMultiplicadorInput] = useState("1.3");
  const [salvandoMultiplicador, setSalvandoMultiplicador] = useState(false);
  // Painel "Agendar Full" — pedido do Guilherme em 2026-08-07: monta o
  // envio da semana (ex: toda sexta) de uma vez, revisando a
  // recomendação de cada SKU antes de confirmar a data de envio.
  const [mostrarAgendamento, setMostrarAgendamento] = useState(false);

  async function carregar() {
    try {
      const [res, enviosRes] = await Promise.all([
        fetch("/api/estoque-full"),
        fetch("/api/full/envios"),
      ]);
      const data = await res.json();
      if (!data.connected) {
        setStatus("desconectado");
        return;
      }
      if (data.error) {
        setStatus("erro");
        return;
      }
      setLinhas(data.linhas);
      setPeriodo(data.periodo);
      setApiDisponivel(Boolean(data.apiDisponivel));
      setUserProductSeller(data.userProductSeller ?? null);
      const mult = Number(data.multiplicador ?? 1.3);
      setMultiplicador(mult);
      setMultiplicadorInput(String(mult).replace(".", ","));
      setEnvios(await enviosRes.json());
      setStatus("ready");
    } catch {
      setStatus("erro");
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  const linhasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter(
      (l) =>
        l.nome.toLowerCase().includes(termo) ||
        l.sku.toLowerCase().includes(termo)
    );
  }, [linhas, busca]);

  // Painel pedido pelo Guilherme em 2026-08-11: "deixe um quadro somente
  // com os anuncios do full sem vendas" - SKUs que nao venderam nada no
  // Full na janela de 7 dias ja usada em todo o resto da tela (mesma
  // fonte: vendidoFull7d, calculado em /api/estoque-full a partir dos
  // pedidos com shippingMode = "Full").
  const semVendaFull = useMemo(
    () => linhasFiltradas.filter((l) => l.vendidoFull7d === 0),
    [linhasFiltradas]
    );

  // Agrupa as linhas com recomendação de envio > 0 pra alimentar o
  // painel "Agendar Full" — mesmo SKU pode aparecer em mais de uma
  // linha quando é produto composto (corpo + gancho, ex: Suporte
  // Universal), já que a mesma venda credita as duas placas
  // componentes; nesse caso NÃO soma vendidoFull7d/recomendado entre
  // elas (já é o mesmo número em cada uma — é a mesma venda), só junta
  // os placaIds pra criar um envio por componente de uma vez.
  const gruposAgendamento = useMemo(() => {
    const porChave = new Map<string, GrupoAgendamento>();
    for (const l of linhas) {
      if (l.recomendacaoEnvio <= 0) continue;
      const chaveGrupo = (l.sku || l.titulo || l.nome).toLowerCase();
      const existente = porChave.get(chaveGrupo);
      if (existente) {
        if (!existente.placaIds.includes(l.placaId)) {
          existente.placaIds.push(l.placaId);
        }
        existente.pecasPorUnidade[l.placaId] = l.pecasPorUnidade;
      } else {
        porChave.set(chaveGrupo, {
          chaveGrupo,
          sku: l.sku || l.nome,
          nome: l.nome,
          titulo: l.titulo,
          placaIds: [l.placaId],
          pecasPorUnidade: { [l.placaId]: l.pecasPorUnidade },
          vendidoFull7d: l.vendidoFull7d,
          recomendado: l.recomendacaoEnvio,
        });
      }
    }
    return Array.from(porChave.values()).sort((a, b) => b.recomendado - a.recomendado);
  }, [linhas]);

  async function ajustarFull(chave: string, placaId: number, delta: number) {
    if (!delta) return;
    setSalvando((prev) => ({ ...prev, [chave]: true }));
    try {
      const res = await fetch("/api/estoque-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave, placaId, delta }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setLinhas((prev) =>
          prev.map((l) =>
            l.chave === chave
              ? {
                  ...l,
                  estoqueFullAtual: atualizado.quantidade_pecas,
                  atualizadoEm: atualizado.atualizado_em,
                }
              : l
          )
        );
      }
    } finally {
      setSalvando((prev) => ({ ...prev, [chave]: false }));
    }
  }

  async function salvarMultiplicador() {
    const valor = Number(multiplicadorInput.replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) return;
    setSalvandoMultiplicador(true);
    try {
      const res = await fetch("/api/full/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ multiplicador: valor }),
      });
      if (res.ok) {
        await carregar();
      }
    } finally {
      setSalvandoMultiplicador(false);
    }
  }

  // Pedido do Guilherme em 2026-07-29: produtos compostos (ex: Suporte
  // Universal, que precisa de 1 placa "Corpos" + 1 placa "Ganchos" pra
  // fechar 1 unidade vendida) devem aparecer como UMA sugestão só na
  // busca — "pra ser vendido precisa de 1 gancho e 1 corpo... mostrar só
  // a SKU principal, a produção é outra coisa". Por isso agora recebe
  // uma LISTA de placaIds (todas as placas componentes daquele SKU) em
  // vez de uma única: cria um envio (full_envios) pra cada placa
  // componente, todos com o mesmo sku/quantidade/dataLimite — assim a
  // tela de produção continua enxergando e cobrando cada placa
  // separadamente (isso é produção, não venda), mas o usuário só
  // precisou escolher e preencher uma vez. Reaproveitada em 2026-08-07
  // pelo painel "Agendar Full" — ver confirmarAgendamento abaixo.
  async function criarEnvio(
    sku: string,
    placaIds: number[],
    quantidade: number,
    dataLimite: string,
    pecasPorUnidade: Record<number, number> = {},
    tituloMl: string | null,
  ) {
    const grupoId = placaIds.length > 1 ? `full-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
    for (const placaId of placaIds) {
      await fetch("/api/full/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku,
          placaId,
          quantidade,
          dataLimite,
          grupoId,
          pecasPorUnidade: pecasPorUnidade[placaId] ?? 1,
          tituloMl,
        }),
      });
    }
    const enviosRes = await fetch("/api/full/envios");
    setEnvios(await enviosRes.json());
  }

  // Agenda o Full da semana de uma vez — pedido do Guilherme em
  // 2026-08-07: "montamos o envio do full na sexta, porém ele é
  // agendado, então mesmo montando na sexta eu vou te confirmar a data
  // que vou enviar". Cria um envio (grupo, se composto) por SKU
  // revisado no painel, todos com a MESMA data de envio escolhida ali.
  async function confirmarAgendamento(
    itens: { sku: string; placaIds: number[]; quantidade: number; pecasPorUnidade: Record<number, number>; titulo?: string | null }[],
    dataLimite: string
  ) {
    for (const item of itens) {
      await criarEnvio(item.sku, item.placaIds, item.quantidade, dataLimite, item.pecasPorUnidade, item.titulo ?? null);
    }
  }

  async function confirmarGrupo(ids: number[]) {
    setEnvios((prev) => prev.filter((e) => !ids.includes(e.id)));
    for (const id of ids) {
      await fetch(`/api/full/envios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmado" }),
      });
    }
    const enviosRes = await fetch("/api/full/envios");
    setEnvios(await enviosRes.json());
  }

  async function editarGrupo(ids: number[], quantidade: number, dataLimite: string) {
    let ok = true;
    for (const id of ids) {
      const res = await fetch(`/api/full/envios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantidade, dataLimite }),
      });
      if (!res.ok) ok = false;
    }
    const enviosRes = await fetch("/api/full/envios");
    setEnvios(await enviosRes.json());
    return ok;
  }

  async function excluirGrupo(ids: number[]) {
    setEnvios((prev) => prev.filter((e) => !ids.includes(e.id)));
    for (const id of ids) {
      await fetch(`/api/full/envios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelado" }),
      });
    }
    const enviosRes = await fetch("/api/full/envios");
    setEnvios(await enviosRes.json());
  }

  if (status === "desconectado") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="mb-2 font-medium text-gray-900">Conecte a aba Vendas primeiro</p>
        <p className="mb-4 text-sm text-gray-500">
          A venda no Full vem dos pedidos da aba Vendas — conecte sua conta
          do Mercado Livre por lá antes de continuar.
        </p>
        <Link
          href="/vendas"
          className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Ir para Vendas
        </Link>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Carregando estoque do Full...
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
        Não deu pra carregar — a sessão da ML pode ter expirado. Reconecte
        na aba Vendas.
      </div>
    );
  }

  const totalVendidoFull = linhasFiltradas.reduce((s, l) => s + l.vendidoFull7d, 0);
  const totalEstoqueFull = linhasFiltradas.reduce((s, l) => s + l.estoqueFullAtual, 0);
  const totalAEnviar = linhasFiltradas.reduce((s, l) => s + l.recomendacaoEnvio, 0);
  const pendentes = linhasFiltradas.filter((l) => l.recomendacaoEnvio > 0).length;
  const enviosPendentes = envios.filter((e) => e.status === "pendente");
  const multiplicadorTexto = String(multiplicador).replace(".", ",");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Peças vendidas no Full (7d)" value={String(totalVendidoFull)} />
        <Card label="Estoque atual no Full" value={String(totalEstoqueFull)} />
        <Card label="Total a enviar" value={String(totalAEnviar)} />
        <Card label="SKUs pendentes de envio" value={String(pendentes)} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">
      Anúncios do Full sem vendas ({semVendaFull.length})
      </h2>
      <p className="mb-3 text-xs text-gray-500">
      SKUs que não tiveram nenhuma venda no Full nos últimos 7 dias
      (período {periodo?.inicio} a {periodo?.fim}).
      </p>
        {semVendaFull.length === 0 ? (
      <p className="text-xs text-gray-400">
      Todos os SKUs tiveram venda no Full nessa janela de 7 dias.
      </p>
      ) : (
      <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-xs">
      <thead className="bg-gray-50 text-left font-semibold uppercase text-gray-500">
      <tr>
      <th className="px-3 py-2">SKU / Placa</th>
      <th className="px-3 py-2">Tier</th>
      <th className="px-3 py-2 text-right">Estoque no Full</th>
      </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {semVendaFull
          .slice()
          .sort((a, b) => b.estoqueFullAtual - a.estoqueFullAtual)
          .map((l) => (
            <tr key={l.chave}>
            <td className="px-3 py-2">
            <p className="font-medium text-gray-900">{l.sku || l.nome}</p>
            <p className="text-gray-400">{l.nome}</p>
            </td>
            <td className="px-3 py-2">
            <TierBadge tier={l.tier} />
            </td>
            <td className="px-3 py-2 text-right text-gray-700">{l.estoqueFullAtual}</td>
            </tr>
            ))}
      </tbody>
      </table>
      </div>
      )}
      </div>
    
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Como funciona a recomendação</p>
        <p className="mt-1">
          Cada linha da tabela abaixo já é um SKU real (ou o SKU
          cadastrado, quando não houve venda no Full na semana).
          &quot;A enviar&quot; = peças vendidas no Full nos últimos 7 dias
          (período {periodo?.inicio} a {periodo?.fim}) × multiplicador de
          envio (hoje {multiplicadorTexto}× — ajustável logo abaixo, no
          bloco &quot;Agendamento semanal do Full&quot;).
          &quot;Estoque no Full&quot; agora é lido automaticamente
          da API da ML (badge{" "}
          <span className="rounded bg-green-100 px-1 py-0.5 font-semibold text-green-700">API</span>
          ) pros SKUs que tiveram venda na semana — só cai pro valor
          digitado manualmente (badge{" "}
          <span className="rounded bg-gray-200 px-1 py-0.5 font-semibold text-gray-700">Manual</span>
          ) quando não há venda recente ou a leitura da API não retornou
          nada. Cada SKU real (ex: com/sem parafuso) tem seu próprio
          valor manual — não é mais compartilhado entre variantes da
          mesma placa.
          {!apiDisponivel && (
            <>
              {" "}
              Nenhum SKU retornou leitura via API ainda nesta consulta.
              {userProductSeller === false ? (
                <>
                  {" "}
                  Motivo confirmado: sua conta na ML ainda não está no
                  modelo &quot;User Products&quot; (sem a tag
                  &quot;user_product_seller&quot;) — enquanto isso não
                  mudar do lado da ML, os itens não têm user_product_id
                  e essa leitura automática não tem como funcionar. O
                  ajuste manual continua sendo o caminho até lá.
                </>
              ) : userProductSeller === true ? (
                <>
                  {" "}
                  Sua conta já está no modelo &quot;User Products&quot;,
                  então pode ser sessão da ML expirada ou nenhuma venda
                  no Full na janela de 7 dias (sem venda recente não
                  temos o item pra consultar).
                </>
              ) : (
                <> Pode ser sessão da ML expirada — reconecte na aba Vendas.</>
              )}
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Agendamento semanal do Full</h2>
          <p className="mt-1 text-xs text-gray-500">
            Monte o envio da semana de uma vez (ex: toda sexta-feira): revise a
            recomendação de cada SKU e confirme a data que vai enviar. Os
            produtos entram na lista &quot;Envios planejados&quot; abaixo já
            como &quot;Agendado&quot;.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Multiplicador</label>
          <input
            type="text"
            inputMode="decimal"
            value={multiplicadorInput}
            onChange={(e) => setMultiplicadorInput(e.target.value)}
            className="w-16 rounded border border-gray-300 px-2 py-1.5 text-xs text-right"
          />
          <button
            type="button"
            onClick={salvarMultiplicador}
            disabled={salvandoMultiplicador}
            className="rounded border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {salvandoMultiplicador ? "Salvando..." : "Salvar"}
          </button>
          <button
            type="button"
            onClick={() => setMostrarAgendamento(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Agendar Full
          </button>
        </div>
      </div>

      <EnviosPlanejados
        linhas={linhas}
        envios={enviosPendentes}
        onCriar={criarEnvio}
        onConfirmar={confirmarGrupo}
        onEditar={editarGrupo}
        onExcluir={excluirGrupo}
      />

      <AgendamentoFullPanel
        aberto={mostrarAgendamento}
        onFechar={() => setMostrarAgendamento(false)}
        grupos={gruposAgendamento}
        onConfirmar={confirmarAgendamento}
      />

      <div>
        <input
          type="text"
          placeholder="Buscar por nome ou SKU..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">SKU / Placa</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2 text-right">Vendido no Full (7d)</th>
              <th className="px-3 py-2 text-right">Estoque no Full (fonte)</th>
              <th className="px-3 py-2">Ajustar estoque Full</th>
              <th className="px-3 py-2 text-right">A enviar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhasFiltradas
              .slice()
              .sort((a, b) => b.recomendacaoEnvio - a.recomendacaoEnvio)
              .map((linha) => (
                <LinhaFullRow
                  key={linha.chave}
                  linha={linha}
                  salvando={Boolean(salvando[linha.chave])}
                  onAjustar={(delta) => ajustarFull(linha.chave, linha.placaId, delta)}
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

// Selo de viabilidade de produção — pedido do Guilherme em 2026-07-29:
// "conferir a possibilidade para produção sem comprometer mais de 50%
// minha linha de produção, caso não comprometa, podemos aprovar esse
// produto para envio". O cálculo em si vem pronto do servidor (ver
// lib/capacidade.ts) — aqui só decide qual selo mostrar:
// - nada falta produzir → "—" (não compromete nada, não precisa de selo);
// - data limite não deixa mais tempo de máquina disponível → "sem tempo";
// - senão, percentual da capacidade teórica da linha que esse envio
//   tomaria até a data limite, verde (≤50%, aprovado) ou âmbar (>50%,
//   risco — decisão manual do Guilherme: adiar, dividir ou aceitar mesmo
//   assim).
function ViabilidadeBadge({ envio }: { envio: EnvioFull }) {
  if (envio.faltantePlaca <= 0) {
    return <span className="text-gray-400">—</span>;
  }
  if (!Number.isFinite(envio.percentualComprometido) || envio.capacidadeDisponivelHoras <= 0) {
    return (
      <span
        className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700"
        title={`Precisa de ${envio.horasNecessarias.toFixed(1)}h de impressora — a data limite não deixa mais tempo de produção disponível.`}
      >
        sem tempo
      </span>
    );
  }
  const percentual = Math.round(envio.percentualComprometido * 100);
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 font-semibold " +
        (envio.aprovado ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800")
      }
      title={`Precisa de ${envio.horasNecessarias.toFixed(1)}h de impressora, de ${envio.capacidadeDisponivelHoras.toFixed(
        1
      )}h disponíveis (todas as máquinas ativas) até a data limite.`}
    >
      {envio.aprovado ? "aprovado" : "risco"} · {percentual}%
    </span>
  );
}

// Painel "Agendar Full" — pedido do Guilherme em 2026-08-07: gera de uma
// vez a lista de produtos recomendados (vendido na semana × multiplicador)
// pra montar o envio do Full, com a quantidade de cada SKU editável antes
// de confirmar. A data escolhida aqui é única pra todo o lote (é a data
// que ele vai enviar esse Full, decidida depois de montar fisicamente).
function AgendamentoFullPanel({
  aberto,
  onFechar,
  grupos,
  onConfirmar,
}: {
  aberto: boolean;
  onFechar: () => void;
  grupos: GrupoAgendamento[];
  onConfirmar: (
    itens: { sku: string; placaIds: number[]; quantidade: number; pecasPorUnidade: Record<number, number>; titulo?: string | null }[],
    dataLimite: string
  ) => Promise<void>;
}) {
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [incluidos, setIncluidos] = useState<Record<string, boolean>>({});
  const [dataEnvio, setDataEnvio] = useState(todaySP());
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setQuantidades(
      Object.fromEntries(grupos.map((g) => [g.chaveGrupo, String(g.recomendado)]))
    );
    setIncluidos(Object.fromEntries(grupos.map((g) => [g.chaveGrupo, true])));
    setDataEnvio(todaySP());
  }, [aberto, grupos]);

  if (!aberto) return null;

  const totalSelecionado = grupos
    .filter((g) => incluidos[g.chaveGrupo])
    .reduce((soma, g) => soma + (Number(quantidades[g.chaveGrupo]) || 0), 0);

  async function confirmar() {
    const itens = grupos
      .filter((g) => incluidos[g.chaveGrupo])
      .map((g) => ({
        sku: g.sku,
        placaIds: g.placaIds,
        quantidade: Number(quantidades[g.chaveGrupo]) || 0,
        pecasPorUnidade: g.pecasPorUnidade,
        titulo: g.titulo,
      }))
      .filter((item) => item.quantidade > 0);
    if (itens.length === 0 || !dataEnvio) return;
    setEnviando(true);
    try {
      await onConfirmar(itens, dataEnvio);
      onFechar();
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">Agendar Full</h2>
          <button
            type="button"
            onClick={onFechar}
            className="text-gray-400 hover:text-gray-600"
            title="Fechar"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <p className="mb-4 text-xs text-gray-500">
            Confira o SKU e a quantidade de cada produto antes de agendar —
            preste atenção nas variações (com/sem parafuso, cor etc.), já que
            é exatamente esse SKU que você vai preencher no Mercado Livre.
            Desmarque o que não for enviar dessa vez, ajuste a quantidade se
            precisar, e escolha a data em que vai enviar esse Full.
          </p>
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Data que vou enviar
            </label>
            <input
              type="date"
              value={dataEnvio}
              onChange={(e) => setDataEnvio(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {grupos.length === 0 ? (
            <p className="text-sm text-gray-400">
              Nenhum produto com recomendação de envio essa semana.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-left font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Incluir</th>
                    <th className="px-3 py-2">Produto / SKU</th>
                    <th className="px-3 py-2 text-right">Vendido (7d)</th>
                    <th className="px-3 py-2 text-right">Quantidade a enviar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {grupos.map((g) => (
                    <tr key={g.chaveGrupo}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(incluidos[g.chaveGrupo])}
                          onChange={(e) =>
                            setIncluidos((prev) => ({
                              ...prev,
                              [g.chaveGrupo]: e.target.checked,
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{g.sku}</p>
                        <p className="text-gray-400">{g.nome}</p>
                        {g.titulo && (
                          <p className="mt-0.5 text-blue-700">Anúncio ML: {g.titulo}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">{g.vendidoFull7d}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={quantidades[g.chaveGrupo] ?? ""}
                          onChange={(e) =>
                            setQuantidades((prev) => ({
                              ...prev,
                              [g.chaveGrupo]: e.target.value,
                            }))
                          }
                          className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-gray-200 p-4">
          <p className="text-xs text-gray-500">
            {grupos.filter((g) => incluidos[g.chaveGrupo]).length} produto(s)
            selecionado(s) · {totalSelecionado} peças no total
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onFechar}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={enviando || grupos.length === 0}
              onClick={confirmar}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {enviando ? "Agendando..." : "Confirmar agendamento"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Seção de envios planejados do Full — pedido do Guilherme em
// 2026-07-25. Formulário (data + SKU + quantidade) + lista dos envios
// ainda pendentes, cada um com um botão "Confirmar envio" que tira essa
// produção da linha de frente da fila de prioridade (ver
// app/producao/page.tsx, critério nº-2).
interface GrupoEnvio {
  chave: string;
  ids: number[];
  sku: string;
  placaNomes: string[];
  quantidade: number;
  dataLimite: string;
  membros: EnvioFull[];
  pecasPorUnidade: number;
}

function EnviosPlanejados({
  linhas,
  envios,
  onCriar,
  onConfirmar,
  onEditar,
  onExcluir,
}: {
  linhas: LinhaFull[];
  envios: EnvioFull[];
  onCriar: (
    sku: string,
    placaIds: number[],
    quantidade: number,
    dataLimite: string,
    pecasPorUnidade?: Record<number, number>
  ) => Promise<void>;
  onConfirmar: (ids: number[]) => Promise<void>;
  onEditar: (ids: number[], quantidade: number, dataLimite: string) => Promise<boolean>;
  onExcluir: (ids: number[]) => Promise<void>;
}) {
  const [buscaSku, setBuscaSku] = useState("");
  const [resultados, setResultados] = useState<SkuResult[]>([]);
  const [selecionado, setSelecionado] = useState<{
    sku: string;
    placaIds: number[];
    label: string;
    pecasPorUnidade: Record<number, number>;
  } | null>(null);
  const [quantidade, setQuantidade] = useState("");
  const [dataLimite, setDataLimite] = useState(todaySP());
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState<Record<string, boolean>>({});
  const [excluindo, setExcluindo] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<Record<string, { quantidade: string; dataLimite: string }>>(
    {}
  );
  const [salvandoEdicao, setSalvandoEdicao] = useState<Record<string, boolean>>({});
    const [previewViabilidade, setPreviewViabilidade] = useState<{
          status: "idle" | "loading" | "ok" | "erro";
          data: {
                  horasNecessarias: number;
                  capacidadeDisponivelHoras: number;
                  percentual: number;
                  viavel100: boolean;
                  dataMinimaViavel: string | null;
                  numMaquinasAtivas: number;
          } | null;
    }>({ status: "idle", data: null });

  useEffect(() => {
    if (buscaSku.trim().length < 2) {
      setResultados([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const res = await fetch(
        `/api/skus?q=${encodeURIComponent(buscaSku.trim())}&agrupar=false`
      );
      setResultados(await res.json());
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscaSku]);

    // Preview de viabilidade em tempo real -- pedido do Guilherme em
    // 2026-08-14: "quando eu colocar a data que quero enviar o produto,
    // deve fazer o envio com a possibilidade de eu conseguir enviar 100%
    // da sugestao". Assim que SKU + quantidade + data estiverem
    // preenchidos, consulta o servidor pra saber se da pra produzir tudo
    // que falta ate essa data com as maquinas ativas -- antes mesmo de
    // clicar em "Adicionar envio".
    useEffect(() => {
          if (!selecionado || !quantidade || Number(quantidade) <= 0 || !dataLimite) {
                  setPreviewViabilidade({ status: "idle", data: null });
                  return;
          }
          setPreviewViabilidade({ status: "loading", data: null });
          const timeout = setTimeout(async () => {
                  try {
                            const res = await fetch("/api/full/envios/viabilidade", {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                                      itens: selecionado.placaIds.map((id) => ({
                                                                      placaId: id,
                                                                      pecasPorUnidade: selecionado.pecasPorUnidade[id] ?? 1,
                                                      })),
                                                      quantidade: Number(quantidade),
                                                      dataLimite,
                                        }),
                            });
                            if (!res.ok) throw new Error("falha");
                            const data = await res.json();
                            setPreviewViabilidade({ status: "ok", data });
                  } catch {
                            setPreviewViabilidade({ status: "erro", data: null });
                  }
          }, 400);
          return () => clearTimeout(timeout);
    }, [selecionado, quantidade, dataLimite]);

  const sugestoes = useMemo(() => {
    const porSku = new Map<
      string,
      { sku: string; placaIds: number[]; placaNomes: string[]; pecasPorUnidade: Record<number, number> }
    >();
    for (const r of resultados) {
      const existente = porSku.get(r.sku);
      if (existente) {
        if (!existente.placaIds.includes(r.placa_id)) {
          existente.placaIds.push(r.placa_id);
          existente.placaNomes.push(r.placa_nome);
        }
        existente.pecasPorUnidade[r.placa_id] = Number(r.pecas_por_unidade);
      } else {
        porSku.set(r.sku, {
          sku: r.sku,
          placaIds: [r.placa_id],
          placaNomes: [r.placa_nome],
          pecasPorUnidade: { [r.placa_id]: Number(r.pecas_por_unidade) },
        });
      }
    }
    return Array.from(porSku.values());
  }, [resultados]);

  const grupos = useMemo(() => {
    const porChave = new Map<string, GrupoEnvio>();
    for (const e of envios) {
      const chave = e.grupoId ?? `id-${e.id}`;
      const existente = porChave.get(chave);
      if (existente) {
        existente.ids.push(e.id);
        existente.membros.push(e);
        if (!existente.placaNomes.includes(e.placaNome)) {
          existente.placaNomes.push(e.placaNome);
        }
      } else {
        porChave.set(chave, {
          chave,
          ids: [e.id],
          sku: e.sku,
          placaNomes: [e.placaNome],
          quantidade: e.quantidade,
          dataLimite: e.dataLimite,
          membros: [e],
          pecasPorUnidade: e.pecasPorUnidade,
        });
      }
    }
    return Array.from(porChave.values());
  }, [envios]);

  async function enviar() {
    if (!selecionado || !quantidade || Number(quantidade) <= 0 || !dataLimite) return;
    setEnviando(true);
    try {
      await onCriar(
        selecionado.sku,
        selecionado.placaIds,
        Number(quantidade),
        dataLimite,
        selecionado.pecasPorUnidade
      );
      setSelecionado(null);
      setBuscaSku("");
      setQuantidade("");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Envios planejados do Full</h2>
      <p className="mb-3 text-xs text-gray-500">
        Registre aqui a data limite, o SKU e a quantidade de cada envio que
        você precisa preparar (ou use o botão &quot;Agendar Full&quot; ali
        em cima pra montar tudo de uma vez). Se o estoque atual + o que já
        está sendo produzido não cobrir a quantidade, essa placa vira
        prioridade extraordinária na fila de produção — acima até do
        backlog de despacho — até ser produzida ou o envio ser confirmado.
        A coluna &quot;Linha de produção&quot; mostra se dá pra produzir o
        que falta até a data limite sem tomar mais de 50% da capacidade
        das máquinas (
        <span className="rounded bg-green-100 px-1 py-0.5 font-semibold text-green-700">
          aprovado
        </span>{" "}
        = pode enviar sem sacrificar a produção normal;{" "}
        <span className="rounded bg-amber-100 px-1 py-0.5 font-semibold text-amber-800">
          risco
        </span>{" "}
        = decida se adia, divide ou aceita mesmo assim).
      </p>

      <div className="mb-4 flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-3 sm:flex-row sm:items-end sm:gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">SKU do produto</label>
          <input
            type="text"
            placeholder="Buscar SKU..."
            value={selecionado ? selecionado.label : buscaSku}
            onChange={(e) => {
              setSelecionado(null);
              setBuscaSku(e.target.value);
            }}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
          />
          {!selecionado && sugestoes.length > 0 && (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-gray-200 text-xs">
              {sugestoes.map((s) => (
                <li key={s.sku}>
                  <button
                    onClick={() => {
                      setSelecionado({
                        sku: s.sku,
                        placaIds: s.placaIds,
                        label: s.sku,
                        pecasPorUnidade: s.pecasPorUnidade,
                      });
                                      // Preenche a quantidade automaticamente com a recomendacao
                                      // (vendido no Full x multiplicador) -- pedido do Guilherme
                                      // em 2026-08-14, ainda editavel manualmente logo abaixo.
                                      const linhaRecomendada = linhas.find((l) => l.sku === s.sku);
                                      setQuantidade(
                                                          linhaRecomendada && linhaRecomendada.recomendacaoEnvio > 0
                                                            ? String(linhaRecomendada.recomendacaoEnvio)
                                                            : ""
                                                        );
                      setResultados([]);
                    }}
                    className="block w-full px-2 py-1 text-left hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{s.sku}</span>{" "}
                    {s.placaNomes.length > 1 && (
                      <span className="text-gray-400">
                        (produção: {s.placaNomes.join(" + ")})
                      </span>
                    )}
                    {Object.values(s.pecasPorUnidade).some((n) => n > 1) && (
                      <span className="text-amber-700">
                        {" "}
                        ({Object.values(s.pecasPorUnidade).find((n) => n > 1)} peças por unidade)
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="w-full sm:w-28">
          <label className="mb-1 block text-xs font-medium text-gray-500">Quantidade</label>
          <input
            type="number"
            min={1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
          />
        </div>
        <div className="w-full sm:w-40">
          <label className="mb-1 block text-xs font-medium text-gray-500">Enviar até</label>
          <input
            type="date"
            value={dataLimite}
            onChange={(e) => setDataLimite(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
          />
        </div>
        <button
          disabled={!selecionado || !quantidade || Number(quantidade) <= 0 || enviando}
          onClick={enviar}
          className="shrink-0 rounded bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {enviando ? "Salvando..." : "Adicionar envio"}
        </button>
      </div>
      {previewViabilidade.status !== "idle" && (
        <div
          className={`mt-2 rounded border px-3 py-2 text-xs ${
            previewViabilidade.status === "erro"
              ? "border-red-200 bg-red-50 text-red-700"
              : previewViabilidade.status === "loading"
              ? "border-gray-200 bg-gray-50 text-gray-500"
              : previewViabilidade.data?.viavel100
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {previewViabilidade.status === "loading"
            ? "Verificando viabilidade de producao..."
            : previewViabilidade.status === "erro"
            ? "Nao foi possivel verificar a viabilidade agora."
            : previewViabilidade.data?.viavel100
            ? `Da para produzir 100% da quantidade ate ${
                dataLimite ? formatDiaBR(dataLimite) : "a data escolhida"
              } com ${previewViabilidade.data.numMaquinasAtivas} maquina(s) ativa(s) (${Math.round(
                (previewViabilidade.data.percentual || 0) * 100
              )}% da capacidade).`
            : `Nao da tempo de produzir 100% ate essa data com ${
                previewViabilidade.data?.numMaquinasAtivas ?? 0
              } maquina(s) ativa(s) (precisaria de ${Math.round(
                (previewViabilidade.data?.percentual || 0) * 100
              )}% da capacidade).${
                previewViabilidade.data?.dataMinimaViavel
                  ? ` Data minima viavel: ${formatDiaBR(previewViabilidade.data.dataMinimaViavel)}.`
                  : ""
              }`}
        </div>
      )}
      {grupos.length === 0 ? (
        <p className="text-xs text-gray-400">Nenhum envio pendente cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">SKU / Placa</th>
                <th className="px-3 py-2 text-right">Quantidade</th>
                <th className="px-3 py-2">Enviar até</th>
                <th className="px-3 py-2 text-right">Falta produzir</th>
                <th className="px-3 py-2 text-right">Linha de produção</th>
                <th className="px-3 py-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grupos.map((g) => {
                const emEdicao = editando[g.chave];
                const composto = g.membros.length > 1;
                const pior = g.membros.reduce((a, b) =>
                  b.percentualComprometido > a.percentualComprometido ? b : a
                );
                const algumaFalta = g.membros.some((m) => m.faltantePlaca > 0);
                return (
                  <tr key={g.chave}>
                    <td className="px-3 py-2">
                      {composto ? (
                        <>
                          <p className="font-medium text-gray-900">{g.sku}</p>
                          <p className="text-gray-400">Produção: {g.placaNomes.join(" + ")}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-gray-900">{g.membros[0].placaNome}</p>
                          <p className="text-gray-400">SKU: {g.membros[0].tituloMl || g.sku}</p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700">
                      {emEdicao ? (
                        <input
                          type="number"
                          min={1}
                          value={emEdicao.quantidade}
                          onChange={(ev) =>
                            setEditando((prev) => ({
                              ...prev,
                              [g.chave]: { ...prev[g.chave], quantidade: ev.target.value },
                            }))
                          }
                          className="w-20 rounded border border-gray-300 px-1.5 py-1 text-right text-xs"
                        />
                      ) : (
                        <>
                          {g.quantidade}
                          {g.pecasPorUnidade > 1 && (
                            <span className="ml-1 font-normal text-gray-400">
                              ({g.quantidade * g.pecasPorUnidade} peças)
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {emEdicao ? (
                        <input
                          type="date"
                          value={emEdicao.dataLimite}
                          onChange={(ev) =>
                            setEditando((prev) => ({
                              ...prev,
                              [g.chave]: { ...prev[g.chave], dataLimite: ev.target.value },
                            }))
                          }
                          className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                        />
                      ) : (
                        <>
                          <span className="mr-1.5 inline-block rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                            Agendado
                          </span>
                          {formatDiaBR(g.dataLimite)}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!algumaFalta ? (
                        <span className="text-green-700">coberto</span>
                      ) : composto ? (
                        <div className="flex flex-col items-end gap-0.5">
                          {g.membros
                            .filter((m) => m.faltantePlaca > 0)
                            .map((m) => (
                              <span
                                key={m.id}
                                className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700"
                              >
                                {m.placaNome}: faltam {m.faltantePlaca}
                              </span>
                            ))}
                        </div>
                      ) : (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700">
                          faltam {g.membros[0].faltantePlaca}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <ViabilidadeBadge envio={pior} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {emEdicao ? (
                          <>
                            <button
                              disabled={Boolean(salvandoEdicao[g.chave])}
                              onClick={async () => {
                                const qtd = Number(emEdicao.quantidade);
                                if (!qtd || qtd <= 0 || !emEdicao.dataLimite) return;
                                setSalvandoEdicao((prev) => ({ ...prev, [g.chave]: true }));
                                try {
                                  const ok = await onEditar(g.ids, qtd, emEdicao.dataLimite);
                                  if (ok) {
                                    setEditando((prev) => {
                                      const { [g.chave]: _removido, ...resto } = prev;
                                      return resto;
                                    });
                                  }
                                } finally {
                                  setSalvandoEdicao((prev) => ({ ...prev, [g.chave]: false }));
                                }
                              }}
                              className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                            >
                              {salvandoEdicao[g.chave] ? "Salvando..." : "Salvar"}
                            </button>
                            <button
                              onClick={() =>
                                setEditando((prev) => {
                                  const { [g.chave]: _removido, ...resto } = prev;
                                  return resto;
                                })
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                setEditando((prev) => ({
                                  ...prev,
                                  [g.chave]: { quantidade: String(g.quantidade), dataLimite: g.dataLimite },
                                }))
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
                            >
                              Editar
                            </button>
                            <button
                              disabled={Boolean(confirmando[g.chave])}
                              onClick={async () => {
                                setConfirmando((prev) => ({ ...prev, [g.chave]: true }));
                                try {
                                  await onConfirmar(g.ids);
                                } finally {
                                  setConfirmando((prev) => ({ ...prev, [g.chave]: false }));
                                }
                              }}
                              className="rounded border border-green-300 bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-40"
                            >
                              {confirmando[g.chave] ? "Confirmando..." : "Confirmar envio"}
                            </button>
                            <button
                              disabled={Boolean(excluindo[g.chave])}
                              onClick={async () => {
                                if (!window.confirm("Excluir este envio planejado?")) return;
                                setExcluindo((prev) => ({ ...prev, [g.chave]: true }));
                                try {
                                  await onExcluir(g.ids);
                                } finally {
                                  setExcluindo((prev) => ({ ...prev, [g.chave]: false }));
                                }
                              }}
                              className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                            >
                              {excluindo[g.chave] ? "Excluindo..." : "Excluir"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 border-t border-gray-100 pt-3">
        <MovimentacoesFull />
      </div>
    </section>
  );
}

interface MovimentacaoFull {
  id: number;
  data: string;
  envioId: number;
  sku: string;
  placaNome: string;
  placaNumero: number;
  quantidadeUnidades: number;
  pecasPorUnidade: number;
  pecasBaixadas: number;
  dataLimiteEnvio: string;
}

function MovimentacoesFull() {
  const [aberto, setAberto] = useState(false);
  const [movimentos, setMovimentos] = useState<MovimentacaoFull[] | "loading" | "erro" | null>(
    null
  );

  async function alternar() {
    if (!aberto && movimentos === null) {
      setMovimentos("loading");
      try {
        const res = await fetch("/api/full/envios/movimentacoes");
        if (!res.ok) throw new Error("falha");
        setMovimentos(await res.json());
      } catch {
        setMovimentos("erro");
      }
    }
    setAberto((prev) => !prev);
  }

  return (
    <div>
      <button onClick={alternar} className="text-xs font-medium text-blue-600 hover:underline">
        {aberto ? "Fechar movimentações de estoque" : "Ver movimentações de estoque do Full"}
      </button>
      {aberto && (
        <div className="mt-2 overflow-x-auto">
          {movimentos === "loading" || movimentos === null ? (
            <p className="text-xs text-gray-400">Carregando movimentações...</p>
          ) : movimentos === "erro" ? (
            <p className="text-xs text-red-600">Não deu pra carregar as movimentações.</p>
          ) : movimentos.length === 0 ? (
            <p className="text-xs text-gray-400">
              Nenhum envio do Full confirmado ainda (a baixa só acontece na confirmação, não ao
              cadastrar o envio).
            </p>
          ) : (
            <table className="w-full max-w-3xl text-xs">
              <thead className="text-left uppercase text-gray-400">
                <tr>
                  <th className="py-1 pr-3">Quando</th>
                  <th className="py-1 pr-3">SKU</th>
                  <th className="py-1 pr-3">Placa descontada</th>
                  <th className="py-1 pr-3 text-right">Unidades</th>
                  <th className="py-1 pr-3 text-right">Peças descontadas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {movimentos.map((m) => (
                  <tr key={m.id}>
                    <td className="py-1 pr-3 whitespace-nowrap text-gray-500">
                      {new Date(m.data).toLocaleString("pt-BR")}
                    </td>
                    <td className="py-1 pr-3 font-medium text-gray-900">
                      {m.sku} <span className="font-normal text-gray-400">(envio #{m.envioId})</span>
                    </td>
                    <td className="py-1 pr-3 text-gray-600">{m.placaNome}</td>
                    <td className="py-1 pr-3 text-right text-gray-600">
                      {m.quantidadeUnidades}
                      {m.pecasPorUnidade > 1 && (
                        <span className="text-gray-400"> × {m.pecasPorUnidade}</span>
                      )}
                    </td>
                    <td className="py-1 pr-3 text-right font-semibold text-red-600">
                      -{m.pecasBaixadas}
                    </td>
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

function LinhaFullRow({
  linha,
  salvando,
  onAjustar,
}: {
  linha: LinhaFull;
  salvando: boolean;
  onAjustar: (delta: number) => void;
}) {
  const [valor, setValor] = useState("");

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2">
        <p className="font-medium text-gray-900">{linha.sku || linha.nome}</p>
        <p className="text-xs text-gray-400">{linha.nome}</p>
        {linha.titulo ? (
          <p className="mt-1 text-xs text-blue-700">Anúncio ML: {linha.titulo}</p>
        ) : linha.vendidoFull7d === 0 ? (
          <p className="mt-1 text-xs text-gray-400 italic">
            Sem venda no Full na semana — SKU cadastrado no catálogo.
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <TierBadge tier={linha.tier} />
      </td>
      <td className="px-3 py-2 text-right text-gray-700">{linha.vendidoFull7d}</td>
      <td className="px-3 py-2 text-right">
        <span className="font-medium text-gray-900">{linha.estoqueFullAtual}</span>{" "}
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
            (linha.fonteEstoqueFull === "api"
              ? "bg-green-100 text-green-700"
              : "bg-gray-200 text-gray-700")
          }
        >
          {linha.fonteEstoqueFull === "api" ? "API" : "Manual"}
        </span>
      </td>
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
      <td
        className={
          "px-3 py-2 text-right font-semibold " +
          (linha.recomendacaoEnvio > 0 ? "text-amber-700" : "text-gray-400")
        }
      >
        {linha.recomendacaoEnvio}
      </td>
    </tr>
  );
}
