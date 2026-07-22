import Link from "next/link";
import { cookies } from "next/headers";
import {
  getOrdersRange,
  getDailyTotalsRange,
  OrdersResult,
  OrderSummary,
} from "@/lib/ml-orders";
import { formatBRL } from "@/lib/custo";
import { labelOrderStatus } from "@/lib/mercadolivre";
import { todaySP, formatDiaBR, diasAtras, inicioDoMes } from "@/lib/date";
import ItemThumbnail from "@/components/ItemThumbnail";
import VendasTabSwitch from "@/components/VendasTabSwitch";

export const dynamic = "force-dynamic";

function ConnectCard({ erro }: { erro?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p className="mb-2 font-medium text-gray-900">
        Conecte sua conta do Mercado Livre
      </p>
      <p className="mb-4 text-sm text-gray-500">
        Pra puxar os pedidos automaticamente, autorize o acesso à sua conta.
      </p>
      {erro && (
        <p className="mb-4 text-sm text-red-600">
          Não deu pra conectar agora ({erro}). Tenta de novo?
        </p>
      )}
      <a
        href="/api/mercadolivre/authorize"
        className="inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        Conectar com Mercado Livre
      </a>
    </div>
  );
}

function ShopeeConnectCard({ erro }: { erro?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
      <p className="mb-2 font-medium text-gray-900">
        Conecte sua conta da Shopee
      </p>
      <p className="mb-4 text-sm text-gray-500">
        Pra puxar os pedidos automaticamente, autorize o acesso à sua loja.
        (Por enquanto rodando em ambiente de teste/sandbox da Shopee — a
        busca de pedidos de verdade ainda está em construção.)
      </p>
      {erro && (
        <p className="mb-4 text-sm text-red-600">
          Não deu pra conectar agora ({erro}). Tenta de novo?
        </p>
      )}
      <a
        href="/api/shopee/authorize"
        className="inline-block rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
      >
        Conectar com Shopee
      </a>
    </div>
  );
}

function quickBtnClass(active: boolean): string {
  return (
    "rounded-md px-3 py-1 text-sm font-medium " +
    (active
      ? "bg-gray-900 text-white"
      : "border border-gray-300 text-gray-700 hover:bg-gray-50")
  );
}

// Filtro de período — 3 atalhos (Hoje/Ontem/Semana) como links simples
// (funcionam sem JS, é só navegação com query params) + um formulário
// De/Até pra intervalo customizado. O seletor de Plataforma já cobre
// Mercado Livre e Shopee (Shopee ainda só faz o OAuth — busca de pedidos
// de verdade é uma próxima etapa).
function RangeFilter({
  de,
  ate,
  plataforma,
}: {
  de: string;
  ate: string;
  plataforma: string;
}) {
  const hoje = todaySP();
  const ontem = diasAtras(hoje, 1);
  const semanaInicio = diasAtras(hoje, 6);

  const isHoje = de === hoje && ate === hoje;
  const isOntem = de === ontem && ate === ontem;
  const isSemana = de === semanaInicio && ate === hoje;

  const hrefAtalho = (deQ: string, ateQ: string) =>
    `/vendas?de=${deQ}&ate=${ateQ}&plataforma=${plataforma}`;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <div className="flex gap-1.5">
        <Link href={hrefAtalho(hoje, hoje)} className={quickBtnClass(isHoje)}>
          Hoje
        </Link>
        <Link href={hrefAtalho(ontem, ontem)} className={quickBtnClass(isOntem)}>
          Ontem
        </Link>
        <Link
          href={hrefAtalho(semanaInicio, hoje)}
          className={quickBtnClass(isSemana)}
        >
          Semana
        </Link>
      </div>
      <form className="flex flex-wrap items-center gap-2" method="GET">
        <label htmlFor="de" className="text-xs font-medium text-gray-500">
          De
        </label>
        <input
          type="date"
          id="de"
          name="de"
          defaultValue={de}
          max={hoje}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <label htmlFor="ate" className="text-xs font-medium text-gray-500">
          Até
        </label>
        <input
          type="date"
          id="ate"
          name="ate"
          defaultValue={ate}
          max={hoje}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
        <label htmlFor="plataforma" className="text-xs font-medium text-gray-500">
          Plataforma
        </label>
        <select
          id="plataforma"
          name="plataforma"
          defaultValue={plataforma}
          className="rounded-md border border-gray-300 px-2 py-1 text-sm"
        >
          <option value="ml">Mercado Livre</option>
          <option value="shopee">Shopee</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700"
        >
          Buscar
        </button>
      </form>
    </div>
  );
}

// Extrai contagem de pedidos + itens vendidos + faturamento total de um
// resultado de pedidos, tolerante a estados de erro/desconectado (fica em
// 0/0/0). "Itens vendidos" soma a quantidade de cada item de cada
// pedido — diferente de "pedidos", que conta 1 por pedido mesmo que ele
// tenha vários produtos/unidades dentro.
function resumoStats(result: OrdersResult): {
  pedidos: number;
  itensVendidos: number;
  faturamento: number;
} {
  if (!result.connected || result.error)
    return { pedidos: 0, itensVendidos: 0, faturamento: 0 };
  return {
    pedidos: result.orders.length,
    itensVendidos: result.orders.reduce(
      (soma, o) => soma + o.items.reduce((s, item) => s + item.quantity, 0),
      0
    ),
    faturamento: result.orders.reduce((soma, o) => soma + o.totalAmount, 0),
  };
}

function ResumoCard({
  label,
  pedidos,
  itensVendidos,
  faturamento,
  destaque,
}: {
  label: string;
  pedidos: number;
  itensVendidos: number;
  faturamento: number;
  destaque?: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border bg-white p-4 " +
        (destaque ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200")
      }
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{formatBRL(faturamento)}</p>
      <p className="text-xs text-gray-400">
        {pedidos} pedido(s) · {itensVendidos} produto(s) vendido(s)
      </p>
    </div>
  );
}

// Card de recorde (melhor dia): mostra a data do melhor dia dentro da
// janela analisada + o valor faturado nele. Usado tanto pro recorde do
// mês atual (dados já buscados pro card de "Vendas no mês") quanto pro
// recorde da loja nos últimos 90 dias (busca leve dedicada, sem multiget
// de itens nem chamada de shipments por pedido).
function RecordeDiaCard({
  label,
  melhorDia,
}: {
  label: string;
  melhorDia: { dia: string; faturamento: number; pedidos: number } | null;
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs text-amber-700">{label}</p>
      {melhorDia ? (
        <>
          <p className="text-xl font-semibold text-gray-900">
            {formatBRL(melhorDia.faturamento)}
          </p>
          <p className="text-xs text-amber-700">
            {formatDiaBR(melhorDia.dia)} · {melhorDia.pedidos} pedido(s)
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-400">Sem vendas no período</p>
      )}
    </div>
  );
}

// Acha o dia (YYYY-MM-DD, fuso São Paulo) com maior faturamento dentro de
// uma lista de pedidos já buscada — evita uma nova chamada à API quando
// já temos os pedidos do mês em mãos (ver resultMes abaixo).
function melhorDiaDeOrders(
  orders: OrderSummary[]
): { dia: string; faturamento: number; pedidos: number } | null {
  const porDia = new Map<string, { faturamento: number; pedidos: number }>();
  for (const o of orders) {
    const dia = new Date(
      new Date(o.dateCreated).getTime() - 3 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);
    const atual = porDia.get(dia) ?? { faturamento: 0, pedidos: 0 };
    atual.faturamento += o.totalAmount;
    atual.pedidos += 1;
    porDia.set(dia, atual);
  }
  let melhor: { dia: string; faturamento: number; pedidos: number } | null = null;
  for (const [dia, v] of porDia) {
    if (!melhor || v.faturamento > melhor.faturamento) {
      melhor = { dia, ...v };
    }
  }
  return melhor;
}

// Ranking dos produtos mais vendidos por QUANTIDADE dentro do período
// filtrado na tela (mesmos pedidos já buscados pra tabela de "Pedidos" —
// sem chamada extra à API). Agrupa por item_id da ML (cada anúncio/
// variação conta separado, mesmo quando o título é parecido — ex: duas
// cores do mesmo produto aparecem como linhas distintas, já que são
// anúncios/variações diferentes na prática).
interface RankingProduto {
  itemId: string;
  titulo: string;
  sku: string;
  quantidade: number;
  pedidos: number;
}

function rankingPorQuantidade(orders: OrderSummary[]): RankingProduto[] {
  const porItem = new Map<string, RankingProduto>();
  for (const order of orders) {
    for (const item of order.items) {
      const chave = item.itemId || `titulo:${item.title}`;
      const atual = porItem.get(chave) ?? {
        itemId: item.itemId,
        titulo: item.title,
        sku: item.hasCustomSku ? item.sku : "",
        quantidade: 0,
        pedidos: 0,
      };
      atual.quantidade += item.quantity;
      atual.pedidos += 1;
      porItem.set(chave, atual);
    }
  }
  return Array.from(porItem.values()).sort((a, b) => b.quantidade - a.quantidade);
}

function RankingProdutosTable({ ranking }: { ranking: RankingProduto[] }) {
  if (ranking.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
        Nenhum produto vendido no período selecionado.
      </div>
    );
  }

  const maxQuantidade = ranking[0].quantidade;

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3 w-10">#</th>
            <th className="px-4 py-3">Produto</th>
            <th className="px-4 py-3 text-right">Pedidos</th>
            <th className="px-4 py-3 text-right">Qtd. vendida</th>
            <th className="px-4 py-3 w-40">&nbsp;</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ranking.map((r, idx) => (
            <tr key={r.itemId + idx} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
              <td className="px-4 py-3">
                <p className="text-gray-900">{r.titulo}</p>
                <p className="text-xs text-gray-400">
                  {r.sku ? `SKU: ${r.sku}` : `ID ML: ${r.itemId}`}
                </p>
              </td>
              <td className="px-4 py-3 text-right text-gray-500">{r.pedidos}</td>
              <td className="px-4 py-3 text-right font-semibold text-gray-900">
                {r.quantidade}
              </td>
              <td className="px-4 py-3">
                <div className="h-2 rounded bg-gray-100">
                  <div
                    className="h-2 rounded bg-blue-500"
                    style={{ width: `${(r.quantidade / maxQuantidade) * 100}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: { erro?: string; de?: string; ate?: string; plataforma?: string };
}) {
  const hoje = todaySP();
  const plataforma = searchParams.plataforma === "shopee" ? "shopee" : "ml";
  const de = searchParams.de || hoje;
  const ate = searchParams.ate || hoje;

  // Shopee: OAuth já configurado (app "MOROLAR" no Shopee Open Platform,
  // ambiente sandbox por enquanto). A busca de pedidos de verdade
  // (equivalente ao lib/ml-orders.ts) ainda não foi construída — por ora
  // só validamos a conexão e mostramos o botão de autorizar.
  if (plataforma === "shopee") {
    const cookieStore = cookies();
    const shopeeConnected = Boolean(
      cookieStore.get("shopee_access_token")?.value
    );

    if (!shopeeConnected) {
      return (
        <div className="flex flex-col gap-4">
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
          <ShopeeConnectCard erro={searchParams.erro} />
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Conectado com a Shopee! A busca de pedidos ainda está em
          construção — assim que tivermos isso pronto, os pedidos aparecem
          aqui igual à aba do Mercado Livre.
        </div>
      </div>
    );
  }

  const result = await getOrdersRange(de, ate);

  if (!result.connected) {
    return <ConnectCard erro={searchParams.erro} />;
  }

  if (result.error) {
    return (
      <ConnectCard erro="sessão expirada, reconecte" />
    );
  }

  // Resumo semana/mês — sempre relativo a hoje, independente do filtro
  // usado na tabela detalhada abaixo. Reaproveita a consulta já feita
  // quando o filtro coincide com um desses períodos, pra não duplicar
  // chamada à API da ML. O card do período selecionado (1º card) usa
  // `result`, que já é a busca do filtro de data escolhido — por isso
  // muda junto quando o filtro muda.
  const semanaInicio = diasAtras(hoje, 6);
  const mesInicio = inicioDoMes(hoje);
  const noventaDiasInicio = diasAtras(hoje, 89);
  const isRangeSemana = de === semanaInicio && ate === hoje;
  const isRangeMes = de === mesInicio && ate === hoje;
  const [resultSemana, resultMes, recorde90d] = await Promise.all([
    isRangeSemana ? Promise.resolve(result) : getOrdersRange(semanaInicio, hoje),
    isRangeMes ? Promise.resolve(result) : getOrdersRange(mesInicio, hoje),
    getDailyTotalsRange(noventaDiasInicio, hoje),
  ]);
  const resumoSelecionado = resumoStats(result);
  const resumoSemana = resumoStats(resultSemana);
  const resumoMes = resumoStats(resultMes);

  const rotuloPeriodo =
    de === ate ? formatDiaBR(de) : `${formatDiaBR(de)} até ${formatDiaBR(ate)}`;

  // Recorde do mês atual: reaproveita os pedidos já buscados pro card de
  // "Vendas no mês" (resultMes), sem chamada extra à API.
  const melhorDiaMes =
    resultMes.connected && !resultMes.error ? melhorDiaDeOrders(resultMes.orders) : null;

  // Recorde da loja (últimos 90 dias): busca leve dedicada (getDailyTotalsRange),
  // sem multiget de itens nem chamada de shipments por pedido — por isso
  // consegue cobrir uma janela maior sem pesar no carregamento da página.
  let melhorDia90d: { dia: string; faturamento: number; pedidos: number } | null = null;
  if (recorde90d.connected && !recorde90d.error) {
    for (const d of recorde90d.porDia) {
      if (!melhorDia90d || d.faturamento > melhorDia90d.faturamento) melhorDia90d = d;
    }
  }

  const resumo = (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ResumoCard
          label={`Vendas em ${rotuloPeriodo}`}
          pedidos={resumoSelecionado.pedidos}
          itensVendidos={resumoSelecionado.itensVendidos}
          faturamento={resumoSelecionado.faturamento}
          destaque
        />
        <ResumoCard label="Vendas na semana (últimos 7 dias)" pedidos={resumoSemana.pedidos} itensVendidos={resumoSemana.itensVendidos} faturamento={resumoSemana.faturamento} />
        <ResumoCard label="Vendas no mês" pedidos={resumoMes.pedidos} itensVendidos={resumoMes.itensVendidos} faturamento={resumoMes.faturamento} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RecordeDiaCard label="Recorde do mês (melhor dia)" melhorDia={melhorDiaMes} />
        <RecordeDiaCard label="Recorde da loja (melhor dia, últimos 90 dias)" melhorDia={melhorDia90d} />
      </div>
    </div>
  );

  if (result.orders.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {resumo}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            Pedidos — Mercado Livre
          </h2>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhum pedido em {rotuloPeriodo}.
        </div>
      </div>
    );
  }

  const ranking = rankingPorQuantidade(result.orders);

  const pedidosView = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Pedidos — Mercado Livre — {rotuloPeriodo}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {result.orders.length} pedido(s)
          </span>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full table-fixed divide-y divide-gray-200 text-sm">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[13%]" />
            <col className="w-[34%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[12%]" />
          </colgroup>
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Comprador</th>
              <th className="px-4 py-3">Itens</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Envio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  #{order.id}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(order.dateCreated).toLocaleDateString("pt-BR")}
                </td>
                <td className="truncate px-4 py-3">{order.buyerNickname}</td>
                <td className="px-4 py-3 text-gray-500">
                  <div className="flex flex-col gap-1.5">
                    {order.items.map((item, idx) => (
                      <div key={`${item.itemId}-${idx}`} className="flex items-center gap-2">
                        <ItemThumbnail src={item.thumbnail} alt={item.title} />
                        <div className="min-w-0">
                          <p className="truncate text-gray-900">
                            {item.title} x{item.quantity}
                          </p>
                          <p className="truncate text-xs text-gray-400">
                            {item.hasCustomSku ? "SKU" : "ID ML"}: {item.sku}
                          </p>
                          {/* DEBUG temporário — remover depois de achar a causa da foto sumida */}
                          {!item.thumbnail && (
                            <p className="truncate text-[10px] text-gray-300">
                              foto: {item.photoDebug ?? "motivo desconhecido"}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {formatBRL(order.totalAmount)}
                </td>
                <td className="px-4 py-3">{labelOrderStatus(order.status)}</td>
                <td className="px-4 py-3">{order.shippingMode}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const rankingView = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Ranking de produtos mais vendidos (quantidade) — {rotuloPeriodo}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {ranking.length} produto(s) distinto(s)
          </span>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
      </div>
      <RankingProdutosTable ranking={ranking} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {resumo}
      <VendasTabSwitch pedidosView={pedidosView} rankingView={rankingView} />
    </div>
  );
}
