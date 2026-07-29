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
  // Viabilidade de produção sem comprometer mais de 50% da linha —
  // pedido do Guilherme em 2026-07-29. Ver lib/capacidade.ts (calculado
  // no servidor, em app/api/full/envios/route.ts).
  horasNecessarias: number;
  capacidadeDisponivelHoras: number;
  percentualComprometido: number;
  aprovado: boolean;
  // Pedido do Guilherme em 2026-07-29: produtos compostos (Suporte
  // Universal, Carro, BMW...) criam um envio por placa componente por
  // trás, mas precisam aparecer como 1 linha só na tela — grupoId liga
  // essas linhas. null nos envios de placa única (a maioria).
  grupoId: string | null;
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

  async function ajustarFull(chave: string, placaId: number, delta: number) {
    if (!delta) return;
    setSalvando((prev) => ({ ...prev, [chave]: true }));
    try {
      const res = await fetch("/api/estoque-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placaId, delta }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setLinhas((prev) =>
          prev.map((l) =>
            l.placaId === placaId
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
  // precisou escolher e preencher uma vez.
  async function criarEnvio(sku: string, placaIds: number[], quantidade: number, dataLimite: string) {
    // Gera um grupoId só quando há mais de uma placa componente (produto
    // composto) — é o elo que a tela usa pra mostrar essas linhas juntas
    // como 1 só (ver EnviosPlanejados abaixo). Envios de placa única
    // continuam sem grupoId (null), tratados como grupo de 1.
    const grupoId = placaIds.length > 1 ? `full-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
    for (const placaId of placaIds) {
      await fetch("/api/full/envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, placaId, quantidade, dataLimite, grupoId }),
      });
    }
    const enviosRes = await fetch("/api/full/envios");
    setEnvios(await enviosRes.json());
  }

  // Confirma um GRUPO inteiro de envios (todas as placas componentes de
  // um SKU composto, ou só 1 id pros envios de placa única) — pedido do
  // Guilherme em 2026-07-29: mesma ação precisa cobrir corpo + gancho
  // juntos, senão fica faltando dar baixa de uma das duas placas.
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

  // Edita quantidade/data limite de TODAS as placas de um grupo de uma
  // vez — pedido do Guilherme em 2026-07-27: "eu coloquei errado e não
  // tem como editar" (agora estendido pra produtos compostos).
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

  // NOVO — pedido do Guilherme em 2026-07-29: "aqui preciso conseguir
  // excluir". Não existia nenhum jeito de remover um envio criado por
  // engano da lista (só Editar/Confirmar). Reaproveita o mesmo mecanismo
  // de "cancelado" já usado internamente (PATCH status=cancelado), que
  // o GET já filtra da lista de pendentes — não desconta estoque nenhum,
  // já que só confirmar faz isso.
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Peças vendidas no Full (7d)" value={String(totalVendidoFull)} />
        <Card label="Estoque atual no Full" value={String(totalEstoqueFull)} />
        <Card label="Total a enviar" value={String(totalAEnviar)} />
        <Card label="SKUs pendentes de envio" value={String(pendentes)} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Como funciona a recomendação</p>
        <p className="mt-1">
          Cada linha da tabela abaixo já é um SKU real (ou o SKU
          cadastrado, quando não houve venda no Full na semana).
          &quot;A enviar&quot; = peças vendidas no Full nos últimos 7 dias
          (período {periodo?.inicio} a {periodo?.fim}) — repor 1:1 o que
          saiu. &quot;Estoque no Full&quot; agora é lido automaticamente
          da API da ML (badge{" "}
          <span className="rounded bg-green-100 px-1 py-0.5 font-semibold text-green-700">API</span>
          ) pros SKUs que tiveram venda na semana — só cai pro valor
          digitado manualmente (badge{" "}
          <span className="rounded bg-gray-200 px-1 py-0.5 font-semibold text-gray-700">Manual</span>
          ) quando não há venda recente ou a leitura da API não retornou
          nada.
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

      <EnviosPlanejados
        linhas={linhas}
        envios={enviosPendentes}
        onCriar={criarEnvio}
        onConfirmar={confirmarGrupo}
        onEditar={editarGrupo}
        onExcluir={excluirGrupo}
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

// Seção de envios planejados do Full — pedido do Guilherme em
// 2026-07-25. Formulário (data + SKU + quantidade) + lista dos envios
// ainda pendentes, cada um com um botão "Confirmar envio" que tira essa
// produção da linha de frente da fila de prioridade (ver
// app/producao/page.tsx, critério nº-2).
// Uma linha da tabela de envios já agrupada — pedido do Guilherme em
// 2026-07-29: "o suporte universal ainda tem gancho e corpo... mas no
// planejamento do full mostra só a sku principal". Cada grupo junta
// todos os full_envios (linhas do banco, uma por placa componente) que
// compartilham grupoId (produtos compostos) ou, na ausência de
// grupoId, o próprio id (produtos de placa única — a maioria).
interface GrupoEnvio {
  chave: string;
  ids: number[];
  sku: string;
  placaNomes: string[];
  quantidade: number;
  dataLimite: string;
  membros: EnvioFull[];
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
  onCriar: (sku: string, placaIds: number[], quantidade: number, dataLimite: string) => Promise<void>;
  onConfirmar: (ids: number[]) => Promise<void>;
  onEditar: (ids: number[], quantidade: number, dataLimite: string) => Promise<boolean>;
  onExcluir: (ids: number[]) => Promise<void>;
}) {
  const [buscaSku, setBuscaSku] = useState("");
  const [resultados, setResultados] = useState<SkuResult[]>([]);
  const [selecionado, setSelecionado] = useState<{ sku: string; placaIds: number[]; label: string } | null>(
    null
  );
  const [quantidade, setQuantidade] = useState("");
  const [dataLimite, setDataLimite] = useState(todaySP());
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState<Record<string, boolean>>({});
  const [excluindo, setExcluindo] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<Record<string, { quantidade: string; dataLimite: string }>>(
    {}
  );
  const [salvandoEdicao, setSalvandoEdicao] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (buscaSku.trim().length < 2) {
      setResultados([]);
      return;
    }
    const timeout = setTimeout(async () => {
      // agrupar=false: aqui precisamos ver cada SKU real separado (ex: os
      // 4 SKUs do Suporte Secador de Cabelo — Branco/Preto, com/sem
      // parafuso —, mesma placa física, anúncios diferentes). A busca da
      // aba Produção (carregar máquina) continua agrupada por placa.
      const res = await fetch(
        `/api/skus?q=${encodeURIComponent(buscaSku.trim())}&agrupar=false`
      );
      setResultados(await res.json());
    }, 300);
    return () => clearTimeout(timeout);
  }, [buscaSku]);

  // Pedido do Guilherme em 2026-07-29: "para ser vendido precisa de 1
  // gancho e 1 corpo, mostrar só a sku principal, a produção é outra
  // coisa" — a busca acima (agrupar=false) traz uma linha por
  // sku_placa, então um produto composto (Suporte Universal, Suporte
  // Carro etc.) aparece 2-3x, uma vez por placa componente (corpos,
  // ganchos, mista...). Pra quem tá planejando um ENVIO (venda), isso
  // não importa — o que importa é o SKU que vai ser vendido. Aqui
  // reagrupamos por sku de novo, do lado do cliente, juntando todas as
  // placas componentes daquele sku numa lista (placaIds); ao confirmar a
  // sugestão, criamos um envio pra cada placa componente por trás (ver
  // criarEnvio em app/full/page.tsx), sem o usuário precisar escolher
  // linha por linha.
  const sugestoes = useMemo(() => {
    const porSku = new Map<
      string,
      { sku: string; placaIds: number[]; placaNomes: string[] }
    >();
    for (const r of resultados) {
      const existente = porSku.get(r.sku);
      if (existente) {
        if (!existente.placaIds.includes(r.placa_id)) {
          existente.placaIds.push(r.placa_id);
          existente.placaNomes.push(r.placa_nome);
        }
      } else {
        porSku.set(r.sku, { sku: r.sku, placaIds: [r.placa_id], placaNomes: [r.placa_nome] });
      }
    }
    return Array.from(porSku.values());
  }, [resultados]);

  // Mesma lógica de agrupamento da busca acima, agora pra lista de
  // envios JÁ CRIADOS — junta as linhas que vieram da mesma ação de
  // "Adicionar envio" (grupoId, ver criarEnvio em app/full/page.tsx) numa
  // única linha de tabela. Sem grupoId (a maioria dos produtos, de placa
  // única), cada envio continua sendo seu próprio grupo de 1 — nenhuma
  // mudança de comportamento pra eles.
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
        });
      }
    }
    return Array.from(porChave.values());
  }, [envios]);

  async function enviar() {
    if (!selecionado || !quantidade || Number(quantidade) <= 0 || !dataLimite) return;
    setEnviando(true);
    try {
      await onCriar(selecionado.sku, selecionado.placaIds, Number(quantidade), dataLimite);
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
        você precisa preparar. Se o estoque atual + o que já está sendo
        produzido não cobrir a quantidade, essa placa vira prioridade
        extraordinária na fila de produção — acima até do backlog de
        despacho — até ser produzida ou o envio ser confirmado. A coluna
        &quot;Linha de produção&quot; mostra se dá pra produzir o que falta
        até a data limite sem tomar mais de 50% da capacidade das
        máquinas (
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
                      });
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
                // "Pior caso" entre os componentes — quem tem mais peças
                // faltando decide o badge de viabilidade da linha inteira.
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
                          <p className="text-gray-400">SKU: {g.sku}</p>
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
                        g.quantidade
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
                        formatDiaBR(g.dataLimite)
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
                            {/* NOVO — pedido do Guilherme em 2026-07-29: "aqui
                                preciso conseguir excluir". Confirma antes de
                                apagar pra evitar clique acidental; excluir um
                                grupo composto remove TODAS as placas
                                componentes daquele envio de uma vez. */}
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
    </section>
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
