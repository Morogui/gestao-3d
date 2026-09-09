import Link from "next/link";
import { OrdersResult, OrderSummary, DailyTotalsResult, pedidoFoiVendido } from "@/lib/ml-orders";
// Lê do registro local (pedidos_cache) em vez de bater na API da ML/Shopee
// ao vivo a cada carregamento da tela — pedido do Guilherme em 2026-07-24
// pra Vendas mostrar dados "quase em tempo real" sem depender de uma
// chamada ao vivo por visita. O registro é mantido pelo cron de 1 em 1
// minuto em /api/pedidos/sincronizar (ver lib/pedidos-cache.ts). Mesma
// assinatura/retorno de antes (OrdersResult/DailyTotalsResult), só troca a
// fonte dos dados — o resto da tela (buscarOrders, resumoStats,
// melhorDiaDeOrders etc.) não precisa mudar.
import {
  getOrdersRangeML,
  getOrdersRangeShopee,
  getDailyTotalsRangeML,
  getDailyTotalsRangeShopee,
} from "@/lib/pedidos-cache";
import { formatBRL } from "@/lib/custo";
import { labelOrderStatus } from "@/lib/mercadolivre";
import { labelShopeeOrderStatus } from "@/lib/shopee";
import { todaySP, formatDiaBR, diasAtras, inicioDoMes } from "@/lib/date";
import ItemThumbnail from "@/components/ItemThumbnail";
import VendasTabSwitch from "@/components/VendasTabSwitch";
import OcultarNumeros from "@/components/OcultarNumeros";
import { getCustoPorSku, getConfigPrecificacao, calcularMargemPedido, MargemPedido } from "@/lib/margem";
import { getAdsInvestimentoRange, getAdsInvestimentoDoDia } from "@/lib/ads-investimento";
import AdsInvestimentoForm from "@/components/AdsInvestimentoForm";
import TopProdutosCardToggle from "@/components/TopProdutosCardToggle";


export const dynamic = "force-dynamic";

type Plataforma = "ml" | "shopee" | "todas";

function parsePlataforma(valor: string | undefined): Plataforma {
  if (valor === "shopee") return "shopee";
  if (valor === "ml") return "ml";
  return "todas";
}

type StatusConta = "ok" | "desconectado" | "erro" | "n/a";

interface BuscaResult {
  orders: OrderSummary[];
  mlStatus: StatusConta;
  shopeeStatus: StatusConta;
}

function statusDe(result: OrdersResult): StatusConta {
  if (!result.connected) return "desconectado";
  if (result.error) return "erro";
  return "ok";
}

// Busca pedidos de acordo com a Plataforma escolhida. No modo "Todas" (o
// padrão), busca Mercado Livre + Shopee em paralelo e mescla os pedidos
// num só array, ordenado por data — é o que permite a tela mostrar
// faturamento/pedidos/ranking somados das duas lojas, com um filtro pra
// separar por plataforma quando precisar conferir uma de cada vez.
async function buscarOrders(
  plataforma: Plataforma,
  de: string,
  ate: string
): Promise<BuscaResult> {
  if (plataforma === "ml") {
    const r = await getOrdersRangeML(de, ate);
    return {
      orders: r.connected && !r.error ? r.orders : [],
      mlStatus: statusDe(r),
      shopeeStatus: "n/a",
    };
  }
  if (plataforma === "shopee") {
    const r = await getOrdersRangeShopee(de, ate);
    return {
      orders: r.connected && !r.error ? r.orders : [],
      mlStatus: "n/a",
      shopeeStatus: statusDe(r),
    };
  }
  const [rml, rshopee] = await Promise.all([
    getOrdersRangeML(de, ate),
    getOrdersRangeShopee(de, ate),
  ]);
  const orders = [
    ...(rml.connected && !rml.error ? rml.orders : []),
    ...(rshopee.connected && !rshopee.error ? rshopee.orders : []),
  ].sort(
    (a, b) => new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime()
  );
  return { orders, mlStatus: statusDe(rml), shopeeStatus: statusDe(rshopee) };
}

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

// Badge pequeno indicando de qual plataforma veio um pedido/produto —
// usado nas tabelas de Pedidos e Ranking quando estão mostrando as duas
// lojas juntas (modo "Todas"), pra dar rastreabilidade sem precisar de
// uma coluna extra.
function PlataformaBadge({ plataforma }: { plataforma: "ml" | "shopee" }) {
  return (
    <span
      className={
        "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
        (plataforma === "shopee"
          ? "bg-orange-100 text-orange-700"
          : "bg-blue-100 text-blue-700")
      }
    >
      {plataforma === "shopee" ? "Shopee" : "ML"}
    </span>
  );
}

// Filtro de período — 3 atalhos (Hoje/Ontem/Semana) como links simples
// (funcionam sem JS, é só navegação com query params) + um formulário
// De/Até pra intervalo customizado. Plataforma tem 3 opções: Todas
// (padrão — soma Mercado Livre + Shopee), ou uma de cada vez pra
// conferir/filtrar separado.
function RangeFilter({
  de,
  ate,
  plataforma,
}: {
  de: string;
  ate: string;
  plataforma: Plataforma;
}) {
  const hoje = todaySP();
  const ontem = diasAtras(hoje, 1);
  const semanaInicio = diasAtras(hoje, 6);
  const mesInicio = inicioDoMes(hoje);

  const isHoje = de === hoje && ate === hoje;
  const isOntem = de === ontem && ate === ontem;
  const isSemana = de === semanaInicio && ate === hoje;
  const isMes = de === mesInicio && ate === hoje;

  const hrefAtalho = (deQ: string, ateQ: string) =>
    `/vendas?de=${deQ}&ate=${ateQ}&plataforma=${plataforma}`;

  // Plataforma agora é botão de atalho (igual Hoje/Ontem/Semana/Mês), não
  // dropdown — troca na hora, sem precisar submeter formulário. Mantém o
  // de/até atual ao trocar de plataforma.
  const hrefPlataforma = (p: Plataforma) => `/vendas?de=${de}&ate=${ate}&plataforma=${p}`;

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
        <Link href={hrefAtalho(mesInicio, hoje)} className={quickBtnClass(isMes)}>
          Mês
        </Link>
      </div>
      <div className="flex gap-1.5">
        <Link href={hrefPlataforma("todas")} className={quickBtnClass(plataforma === "todas")}>
          Todas
        </Link>
        <Link href={hrefPlataforma("shopee")} className={quickBtnClass(plataforma === "shopee")}>
          Shopee
        </Link>
        <Link href={hrefPlataforma("ml")} className={quickBtnClass(plataforma === "ml")}>
          Mercado Livre
        </Link>
      </div>
      <form className="flex flex-wrap items-center gap-2" method="GET">
        {/* Preserva a plataforma escolhida quando o formulário de data é
            submetido — só os campos de/até vêm do usuário aqui. */}
        <input type="hidden" name="plataforma" value={plataforma} />
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

// Extrai contagem de pedidos + itens vendidos + faturamento total de uma
// lista de pedidos já resolvida (mesclada ou de uma plataforma só).
//
// 2026-09-08: os cards de resumo/ranking/recorde da tela agora passam só
// pedidos JÁ FILTRADOS por pedidoFoiVendido() pra cá (ver vendidos() logo
// abaixo) — antes essa função somava TODO pedido cacheado (incluindo
// payment_required/cancelled da ML e UNPAID/CANCELLED da Shopee), o que
// fazia os números da aba Vendas ficarem bem maiores do que o que a
// própria ML/Shopee mostram nos paineis delas (que só contam venda de
// verdade). resumoStats() em si continua "burra" (só soma o que
// recebe) — o filtro é responsabilidade de quem chama.
function resumoStats(orders: OrderSummary[]): {
  pedidos: number;
  itensVendidos: number;
  faturamento: number;
} {
  return {
    pedidos: orders.length,
    itensVendidos: orders.reduce(
      (soma, o) => soma + o.items.reduce((s, item) => s + item.quantity, 0),
      0
    ),
    faturamento: orders.reduce((soma, o) => soma + o.totalAmount, 0),
  };
}

// Atalho pra filtrar só pedidos que viraram venda de verdade (ver
// pedidoFoiVendido em lib/ml-orders.ts) — usado por todo cálculo que
// deve bater com o painel oficial da ML/Shopee (resumo, ranking,
// recorde do mês). A tabela "Pedidos" continua mostrando TODOS os
// pedidos (inclusive pendente de pagamento/cancelado, com o Status à
// mostra) — é uma visão de auditoria, não de "vendas".
function vendidos(orders: OrderSummary[]): OrderSummary[] {
  return orders.filter(pedidoFoiVendido);
}

// Atalho pra separar uma lista de pedidos por plataforma — usado pelos
// cards "Mais vendidos" com toggle Todas/ML/Shopee (pedido do Guilherme
// em 2026-09-09).
function porPlataforma(orders: OrderSummary[], plataforma: "ml" | "shopee"): OrderSummary[] {
  return orders.filter((o) => o.plataforma === plataforma);
}

// "comparativo" é o mesmo dado do dia anterior ao período selecionado
// (só calculado quando o filtro é um único dia — de === ate), mostrado
// bem menor/apagado embaixo do número principal. Pedido do Guilherme
// em 2026-07-23: "ali devem mostrar o do dia anterior menor pra eu ter
// noção de diferença dos dias".
function ResumoCard({
  label,
  pedidos,
  itensVendidos,
  faturamento,
  destaque,
  comparativo,
}: {
  label: string;
  pedidos: number;
  itensVendidos: number;
  faturamento: number;
  destaque?: boolean;
  comparativo?: { label: string; faturamento: number; pedidos: number };
}) {
  return (
    <div
      className={
        "rounded-lg border bg-white p-4 " +
        (destaque ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200")
      }
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className="valor-sensivel text-xl font-semibold text-gray-900">
        {formatBRL(faturamento)}
      </p>
      <p className="valor-sensivel text-xs text-gray-400">
        {pedidos} pedido(s) · {itensVendidos} produto(s) vendido(s)
      </p>
      {comparativo && (
        <p className="valor-sensivel mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-400">
          {comparativo.label}: {formatBRL(comparativo.faturamento)} ·{" "}
          {comparativo.pedidos} pedido(s)
        </p>
      )}
    </div>
  );
}

// Card dedicado ao total de pedidos do período selecionado — pedido
// explicitamente pelo Guilherme como um número isolado (não só a
// legenda pequena dentro do card de faturamento).
function TotalPedidosCard({
  label,
  pedidos,
  itensVendidos,
  comparativo,
}: {
  label: string;
  pedidos: number;
  itensVendidos: number;
  comparativo?: { label: string; pedidos: number; itensVendidos: number };
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="valor-sensivel text-xl font-semibold text-gray-900">{pedidos}</p>
      <p className="valor-sensivel text-xs text-gray-400">
        pedido(s) no período · {itensVendidos} produto(s) vendido(s)
      </p>
      {comparativo && (
        <p className="valor-sensivel mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-400">
          {comparativo.label}: {comparativo.pedidos} pedido(s) · {comparativo.itensVendidos} produto(s)
        </p>
      )}
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
          <p className="valor-sensivel text-xl font-semibold text-gray-900">
            {formatBRL(melhorDia.faturamento)}
          </p>
          <p className="valor-sensivel text-xs text-amber-700">
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
// já temos os pedidos do mês em mãos (ver mesResult abaixo).
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
// sem chamada extra à API). Agrupa por plataforma+item_id (cada anúncio/
// variação conta separado, mesmo quando o título é parecido — ex: duas
// cores do mesmo produto aparecem como linhas distintas). Prefixar pela
// plataforma evita que um ID da ML e um item_id da Shopee que por acaso
// coincidam sejam somados como se fossem o mesmo produto.
export interface RankingProduto {
  itemId: string;
  titulo: string;
  sku: string;
  quantidade: number;
  pedidos: number;
  plataforma: "ml" | "shopee";
}

function rankingPorQuantidade(orders: OrderSummary[]): RankingProduto[] {
  const porItem = new Map<string, RankingProduto>();
  for (const order of orders) {
    for (const item of order.items) {
      const chave = `${order.plataforma}:${item.itemId || `titulo:${item.title}`}`;
      const atual = porItem.get(chave) ?? {
        itemId: item.itemId,
        titulo: item.title,
        sku: item.hasCustomSku ? item.sku : "",
        quantidade: 0,
        pedidos: 0,
        plataforma: order.plataforma,
      };
      atual.quantidade += item.quantity;
      atual.pedidos += 1;
      porItem.set(chave, atual);
    }
  }
  return Array.from(porItem.values()).sort((a, b) => b.quantidade - a.quantidade);
}

function RankingProdutosTable({
  ranking,
  mostrarPlataforma,
}: {
  ranking: RankingProduto[];
  mostrarPlataforma: boolean;
}) {
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
            <tr key={r.plataforma + r.itemId + idx} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-gray-400">{idx + 1}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  {mostrarPlataforma && <PlataformaBadge plataforma={r.plataforma} />}
                  <p className="text-gray-900">{r.titulo}</p>
                </div>
                <p className="text-xs text-gray-400">
                  {r.sku ? `SKU: ${r.sku}` : `ID: ${r.itemId}`}
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

// Classifica cada pedido (ML + Shopee) em 3 modalidades de envio — pedido
// do Guilherme em 2026-09-09: "tem que mostrar as 3 modalidades, não
// somente full e flex" + "devemos saber os pedidos que despachamos daqui
// sem ser o flex".
//   - Full: fulfillment pela própria plataforma (ML "Full" / Shopee
//     "Shopee Fulfillment (SPX)") — não passa pela nossa mão.
//   - Flex: entrega no mesmo dia feita por nós via programa da
//     plataforma. Hoje só é identificável no ML (shippingMode "Flex"
//     via logistic_type "self_service") — a API da Shopee não expõe um
//     campo equivalente que distinga "entrega direta pelo vendedor" de
//     "despachado por transportadora comum", então nenhum pedido Shopee
//     cai automaticamente aqui até a Shopee documentar esse dado.
//   - Envio próprio: tudo que a gente mesmo embala e despacha — Coleta/
//     Correios/Agência do ML, e qualquer transportadora da Shopee que
//     não seja o fulfillment da própria Shopee (inclusive Shopee Xpress
//     quando é a gente que leva o pacote até o ponto de coleta).
function contarModalidadesEnvio(
  orders: OrderSummary[]
): { full: number; flex: number; envioProprio: number } {
  let full = 0;
  let flex = 0;
  let envioProprio = 0;
  for (const o of orders) {
    if (o.plataforma === "ml") {
      if (o.shippingMode === "Full") full++;
      else if (o.shippingMode === "Flex") flex++;
      else envioProprio++;
    } else {
      if (o.shippingMode === "Shopee Fulfillment (SPX)") full++;
      else envioProprio++;
    }
  }
  return { full, flex, envioProprio };
}

function ModalidadesEnvioCard({
  label,
  full,
  flex,
  envioProprio,
}: {
  label: string;
  full: number;
  flex: number;
  envioProprio: number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="valor-sensivel mt-1 flex items-baseline gap-3">
        <span className="text-xl font-semibold text-gray-900">{full}</span>
        <span className="text-xs text-gray-400">Full</span>
        <span className="text-xl font-semibold text-gray-900">{flex}</span>
        <span className="text-xs text-gray-400">Flex</span>
        <span className="text-xl font-semibold text-gray-900">{envioProprio}</span>
        <span className="text-xs text-gray-400">Envio próprio</span>
      </div>
      <p className="valor-sensivel mt-1 text-[11px] text-gray-400">
        Envio próprio = despachado por nós (Correios/Agência/Shopee Xpress e afins), sem contar o Flex.
      </p>
    </div>
  );
}

// Card de margem real do periodo (preco de venda - comissao - taxa fixa -
// imposto - embalagem - custo de producao) - ver lib/margem.ts pro
// calculo por pedido. Pedido do Guilherme em 2026-09-08: "temos que
// conseguir ver nossa margem do dia conforme as vendas".
function MargemCard({
  label,
  margemTotal,
  faturamento,
  pedidosParciais,
}: {
  label: string;
  margemTotal: number;
  faturamento: number;
  pedidosParciais: number;
}) {
  const pct = faturamento > 0 ? (margemTotal / faturamento) * 100 : 0;
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <p className="text-xs text-green-700">{label}</p>
      <p className="valor-sensivel text-xl font-semibold text-gray-900">
        {formatBRL(margemTotal)}
      </p>
      <p className="valor-sensivel text-xs text-green-700">
        {pct.toFixed(1)}% de margem sobre o faturamento
      </p>
      {pedidosParciais > 0 && (
        <p className="valor-sensivel mt-1 text-[11px] text-amber-600">
          {pedidosParciais} pedido(s) com item sem custo cadastrado (margem parcial)
        </p>
      )}
    </div>
  );
}

// Card de investimento em Ads do periodo - lancamento manual (ver
// lib/ads-investimento.ts pra entender por que ainda nao puxamos isso
// direto da API do Mercado Ads / Shopee Ads).
function AdsInvestimentoCard({
  label,
  ml,
  shopee,
}: {
  label: string;
  ml: number;
  shopee: number;
}) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <p className="text-xs text-purple-700">{label}</p>
      <p className="valor-sensivel text-xl font-semibold text-gray-900">
        {formatBRL(ml + shopee)}
      </p>
      <p className="valor-sensivel text-xs text-purple-700">
        Mercado Livre: {formatBRL(ml)} · Shopee: {formatBRL(shopee)}
      </p>
    </div>
  );
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: { erro?: string; de?: string; ate?: string; plataforma?: string };
}) {
  const hoje = todaySP();
  const plataforma = parsePlataforma(searchParams.plataforma);
  const de = searchParams.de || hoje;
  const ate = searchParams.ate || hoje;

  const principal = await buscarOrders(plataforma, de, ate);

  // Só bloqueia a tela inteira com o card de conectar quando NENHUMA das
  // plataformas relevantes pro filtro atual está disponível. No modo
  // "Todas", se só uma das duas estiver conectada, mostra os dados dela
  // mesmo assim (com um aviso), em vez de travar tudo.
  const algumaConectada =
    (plataforma !== "shopee" && principal.mlStatus === "ok") ||
    (plataforma !== "ml" && principal.shopeeStatus === "ok");

  if (!algumaConectada) {
    return (
      <div className="flex flex-col gap-4">
        <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {plataforma !== "shopee" && (
            <ConnectCard
              erro={
                principal.mlStatus === "erro"
                  ? "sessão expirada, reconecte"
                  : searchParams.erro
              }
            />
          )}
          {plataforma !== "ml" && (
            <ShopeeConnectCard
              erro={
                principal.shopeeStatus === "erro"
                  ? "sessão expirada, reconecte"
                  : searchParams.erro
              }
            />
          )}
        </div>
      </div>
    );
  }

  // Aviso quando, no modo "Todas", uma das duas plataformas não entrou na
  // conta (não conectada ou sessão expirada) — os números seguem em
  // frente com o que deu pra buscar, mas agora com um botão de reconectar
  // direto (pedido do Guilherme em 2026-07-22: "coloque um botão pra
  // quando o ML ou Shopee expirar a conexão ele aparecer pra eu logar"),
  // em vez de só um aviso em texto sem ação.
  const avisoPlataforma =
    plataforma === "todas"
      ? principal.mlStatus !== "ok"
        ? {
            texto: "Mercado Livre não conectado ou sessão expirada — mostrando só Shopee.",
            href: "/api/mercadolivre/authorize",
            label: "Reconectar Mercado Livre",
          }
        : principal.shopeeStatus !== "ok"
        ? {
            texto: "Shopee não conectada ou sessão expirada — mostrando só Mercado Livre.",
            href: "/api/shopee/authorize",
            label: "Reconectar Shopee",
          }
        : null
      : null;

  // Dados de margem/custo (Custo Produto 3D + Precificação) e de
  // investimento em Ads do período — buscados em paralelo, independentes
  // do filtro de data escolhido nos cards de resumo/ranking acima.
  // Pedido do Guilherme em 2026-09-08.
  const [custoPorSku, configPrecificacao, adsRangeSelecionado, adsHoje] = await Promise.all([
    getCustoPorSku(),
    getConfigPrecificacao(),
    getAdsInvestimentoRange(de, ate),
    getAdsInvestimentoDoDia(hoje),
  ]);

  // Resumo semana/mês — sempre relativo a hoje, independente do filtro
  // usado na tabela detalhada abaixo. Reaproveita a consulta já feita
  // quando o filtro coincide com um desses períodos, pra não duplicar
  // chamada à API. O card do período selecionado (1º card) usa
  // `principal`, que já é a busca do filtro de data escolhido — por isso
  // muda junto quando o filtro muda.
  const semanaInicio = diasAtras(hoje, 6);
  const mesInicio = inicioDoMes(hoje);
  const noventaDiasInicio = diasAtras(hoje, 89);
  const isRangeSemana = de === semanaInicio && ate === hoje;
  const isRangeMes = de === mesInicio && ate === hoje;
  // Recorde da loja (90 dias) usa buscas leves dedicadas (getDailyTotalsRange,
  // sem multiget de itens/foto nem chamada de shipments por pedido) pra
  // cada plataforma conectada, e depois soma dia a dia — assim o recorde
  // sempre reflete as duas lojas juntas no modo "Todas" (pedido do
  // Guilherme em 2026-07-22: "recorde tá faltando Shopee, pode colocar"),
  // só separando quando um filtro de plataforma específico é escolhido.
  // Comparativo "dia anterior" pros 2 primeiros cards — só faz sentido
  // quando o filtro atual é um único dia (de === ate); num intervalo de
  // vários dias não existe um "dia anterior" único pra comparar. Pedido
  // do Guilherme em 2026-07-23: mostrar o valor do dia anterior, menor,
  // pra dar noção de diferença entre os dias.
  const diaAnterior = de === ate ? diasAtras(de, 1) : null;

  const [semanaResult, mesResult, recorde90dML, recorde90dShopee, anteriorResult] =
    await Promise.all([
      isRangeSemana ? Promise.resolve(principal) : buscarOrders(plataforma, semanaInicio, hoje),
      isRangeMes ? Promise.resolve(principal) : buscarOrders(plataforma, mesInicio, hoje),
      plataforma !== "shopee"
        ? getDailyTotalsRangeML(noventaDiasInicio, hoje)
        : Promise.resolve({ connected: false } as DailyTotalsResult),
      plataforma !== "ml"
        ? getDailyTotalsRangeShopee(noventaDiasInicio, hoje)
        : Promise.resolve({ connected: false } as DailyTotalsResult),
      diaAnterior
        ? buscarOrders(plataforma, diaAnterior, diaAnterior)
        : Promise.resolve(null),
    ]);
  // Todos os cards de resumo/ranking/recorde abaixo usam só pedidos que
  // viraram venda de verdade (ver vendidos()/pedidoFoiVendido) — é o que
  // faz esses números baterem com o painel oficial da ML/Shopee. A
  // tabela "Pedidos" (mais abaixo, pedidosView) continua mostrando TODOS
  // os pedidos do período, pendentes/cancelados inclusive, com o Status
  // à mostra — é a visão de auditoria/detalhe, não a de "vendas".
  const resumoSelecionado = resumoStats(vendidos(principal.orders));
  const resumoSemana = resumoStats(vendidos(semanaResult.orders));
  const resumoMes = resumoStats(vendidos(mesResult.orders));
  const resumoAnterior = anteriorResult ? resumoStats(vendidos(anteriorResult.orders)) : null;
  const labelDiaAnterior = diaAnterior ? formatDiaBR(diaAnterior) : null;

  const rotuloPeriodo =
    de === ate ? formatDiaBR(de) : `${formatDiaBR(de)} até ${formatDiaBR(ate)}`;

  const rotuloPlataforma =
    plataforma === "todas"
      ? "Todas as plataformas"
      : plataforma === "shopee"
      ? "Shopee"
      : "Mercado Livre";

  // Recorde do mês atual: reaproveita os pedidos já buscados pro card de
  // "Vendas no mês" (mesResult), sem chamada extra à API.
  const melhorDiaMes = melhorDiaDeOrders(vendidos(mesResult.orders));

  // Recorde da loja (últimos 90 dias): soma dia a dia o que veio de cada
  // plataforma conectada (buscas leves, sem multiget de itens nem chamada
  // de shipments por pedido — por isso conseguem cobrir uma janela maior
  // sem pesar no carregamento da página) antes de achar o melhor dia.
  // getDailyTotalsRangeML/Shopee já devolvem só pedidos vendidos (filtro
  // aplicado em lib/ml-orders.ts e lib/shopee-orders.ts), então não
  // precisa filtrar de novo aqui.
  const porDia90dCombinado = new Map<string, { faturamento: number; pedidos: number }>();
  const acumularPorDia = (result: DailyTotalsResult) => {
    if (!result.connected || result.error) return;
    for (const d of result.porDia) {
      const atual = porDia90dCombinado.get(d.dia) ?? { faturamento: 0, pedidos: 0 };
      atual.faturamento += d.faturamento;
      atual.pedidos += d.pedidos;
      porDia90dCombinado.set(d.dia, atual);
    }
  };
  acumularPorDia(recorde90dML);
  acumularPorDia(recorde90dShopee);
  let melhorDia90d: { dia: string; faturamento: number; pedidos: number } | null = null;
  for (const [dia, v] of porDia90dCombinado) {
    if (!melhorDia90d || v.faturamento > melhorDia90d.faturamento) {
      melhorDia90d = { dia, ...v };
    }
  }
  const mlDisponivelPara90d =
    plataforma !== "shopee" && recorde90dML.connected && !recorde90dML.error;
  const shopeeDisponivelPara90d =
    plataforma !== "ml" && recorde90dShopee.connected && !recorde90dShopee.error;
  const recorde90dIndisponivel = !mlDisponivelPara90d && !shopeeDisponivelPara90d;

  // Calculado aqui (antes do card de resumo) porque agora também
  // alimenta o card "Mais vendidos" na fileira de recordes, além da aba
  // Ranking mais abaixo — mesmos pedidos já buscados, sem chamada extra.
  // Também só considera pedidos vendidos, pelo mesmo motivo dos cards
  // acima. As versões -ML/-Shopee alimentam o toggle Todas/ML/Shopee dos
  // cards "Mais vendidos" (pedido do Guilherme em 2026-09-09) — só fazem
  // sentido mostrar o toggle quando a tela já está em modo "Todas"
  // (mostrarPlataforma abaixo); com um filtro de plataforma específico
  // selecionado, os pedidos já vêm de uma loja só.
  const vendidosPrincipal = vendidos(principal.orders);
  const vendidosSemana = vendidos(semanaResult.orders);
  const vendidosMes = vendidos(mesResult.orders);
  const ranking = rankingPorQuantidade(vendidosPrincipal);
  const rankingML = rankingPorQuantidade(porPlataforma(vendidosPrincipal, "ml"));
  const rankingShopee = rankingPorQuantidade(porPlataforma(vendidosPrincipal, "shopee"));
  // Pedido do Guilherme em 2026-07-25: mais 2 cards de "mais vendidos",
  // pra semana e pro mês — reaproveita semanaResult/mesResult (já
  // buscados pros cards de resumo acima), sem chamada extra à API.
  const rankingSemana = rankingPorQuantidade(vendidosSemana);
  const rankingSemanaML = rankingPorQuantidade(porPlataforma(vendidosSemana, "ml"));
  const rankingSemanaShopee = rankingPorQuantidade(porPlataforma(vendidosSemana, "shopee"));
  const rankingMes = rankingPorQuantidade(vendidosMes);
  const rankingMesML = rankingPorQuantidade(porPlataforma(vendidosMes, "ml"));
  const rankingMesShopee = rankingPorQuantidade(porPlataforma(vendidosMes, "shopee"));

  // Margem real por pedido (ver lib/margem.ts) e contagem de modalidades
  // de envio do período selecionado — reaproveita vendidosPrincipal, já
  // filtrado pra excluir pedidos cancelados/não pagos.
  const margensSelecionadas: MargemPedido[] = vendidosPrincipal.map((o) =>
    calcularMargemPedido(o, custoPorSku, configPrecificacao)
  );
  const margemTotalSelecionado = margensSelecionadas.reduce((s, m) => s + m.margemReal, 0);
  const pedidosParciaisSelecionado = margensSelecionadas.filter(
    (m) => m.itensSemCusto.length > 0
  ).length;
  const modalidadesSelecionado = contarModalidadesEnvio(vendidosPrincipal);

  // Margem de TODOS os pedidos do período (não só os vendidos) — pra
  // mostrar a coluna "Margem" também na tabela "Pedidos" (visão de
  // auditoria, que lista pendentes/cancelados junto). Pedido do
  // Guilherme em 2026-09-09: "aqui nos pedidos, devem mostrar qual foi
  // minha margem nessa venda". Indexado por plataforma+id pra achar
  // rápido na hora de montar cada linha da tabela.
  const margensPedidosView: MargemPedido[] = principal.orders.map((o) =>
    calcularMargemPedido(o, custoPorSku, configPrecificacao)
  );
  const margemPorChave = new Map(
    margensPedidosView.map((m) => [m.order.plataforma + m.order.id, m])
  );

  const mostrarPlataforma = plataforma === "todas";

  const resumo = (
    <div className="flex flex-col gap-4">
      {avisoPlataforma && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <span>{avisoPlataforma.texto}</span>
          <a
            href={avisoPlataforma.href}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
          >
            {avisoPlataforma.label}
          </a>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <ResumoCard
          label={`Vendas em ${rotuloPeriodo}`}
          pedidos={resumoSelecionado.pedidos}
          itensVendidos={resumoSelecionado.itensVendidos}
          faturamento={resumoSelecionado.faturamento}
          destaque
          comparativo={
            resumoAnterior && labelDiaAnterior
              ? {
                  label: labelDiaAnterior,
                  faturamento: resumoAnterior.faturamento,
                  pedidos: resumoAnterior.pedidos,
                }
              : undefined
          }
        />
        <TotalPedidosCard
          label={`Total de pedidos em ${rotuloPeriodo}`}
          pedidos={resumoSelecionado.pedidos}
          itensVendidos={resumoSelecionado.itensVendidos}
          comparativo={
            resumoAnterior && labelDiaAnterior
              ? {
                  label: labelDiaAnterior,
                  pedidos: resumoAnterior.pedidos,
                  itensVendidos: resumoAnterior.itensVendidos,
                }
              : undefined
          }
        />
        <ResumoCard label="Vendas na semana (últimos 7 dias)" pedidos={resumoSemana.pedidos} itensVendidos={resumoSemana.itensVendidos} faturamento={resumoSemana.faturamento} />
        <ResumoCard label="Vendas no mês" pedidos={resumoMes.pedidos} itensVendidos={resumoMes.itensVendidos} faturamento={resumoMes.faturamento} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <RecordeDiaCard label="Recorde do mês (melhor dia)" melhorDia={melhorDiaMes} />
        <TopProdutosCardToggle
          periodo={rotuloPeriodo}
          todas={ranking}
          ml={rankingML}
          shopee={rankingShopee}
          mostrarToggle={mostrarPlataforma}
        />
        {!recorde90dIndisponivel ? (
          <RecordeDiaCard
            label="Recorde da loja (melhor dia, últimos 90 dias)"
            melhorDia={melhorDia90d}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-4 text-xs text-gray-400">
            Recorde de 90 dias indisponível agora — reconecte a(s) plataforma(s) acima.
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MargemCard
          label={`Margem real em ${rotuloPeriodo}`}
          margemTotal={margemTotalSelecionado}
          faturamento={resumoSelecionado.faturamento}
          pedidosParciais={pedidosParciaisSelecionado}
        />
        <ModalidadesEnvioCard
          label={`Modalidade de envio — ${rotuloPeriodo}`}
          full={modalidadesSelecionado.full}
          flex={modalidadesSelecionado.flex}
          envioProprio={modalidadesSelecionado.envioProprio}
        />
        <AdsInvestimentoCard
          label={`Investimento em Ads — ${rotuloPeriodo}`}
          ml={adsRangeSelecionado.ml}
          shopee={adsRangeSelecionado.shopee}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TopProdutosCardToggle
          periodo="últimos 7 dias"
          todas={rankingSemana}
          ml={rankingSemanaML}
          shopee={rankingSemanaShopee}
          mostrarToggle={mostrarPlataforma}
        />
        <TopProdutosCardToggle
          periodo="mês"
          todas={rankingMes}
          ml={rankingMesML}
          shopee={rankingMesShopee}
          mostrarToggle={mostrarPlataforma}
        />
      </div>
    </div>
  );

  const pedidosView = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Pedidos — {rotuloPlataforma} — {rotuloPeriodo}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {principal.orders.length} pedido(s)
          </span>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
      </div>
      {principal.orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhum pedido em {rotuloPeriodo}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full table-fixed divide-y divide-gray-200 text-sm">
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[30%]" />
              <col className="w-[8%]" />
              <col className="w-[9%]" />
              <col className="w-[9%]" />
              <col className="w-[19%]" />
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
                <th className="px-4 py-3 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {principal.orders.map((order) => {
                const margem = margemPorChave.get(order.plataforma + order.id);
                return (
                <tr key={order.plataforma + order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {mostrarPlataforma && (
                      <div className="mb-1">
                        <PlataformaBadge plataforma={order.plataforma} />
                      </div>
                    )}
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
                              {item.hasCustomSku ? "SKU" : "ID"}: {item.sku}
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
                  <td className="px-4 py-3">
                    {order.plataforma === "shopee"
                      ? labelShopeeOrderStatus(order.status)
                      : labelOrderStatus(order.status)}
                  </td>
                  <td className="px-4 py-3">{order.shippingMode}</td>
                  <td className="px-4 py-3 text-right">
                    {margem ? (
                      <>
                        <span
                          className={
                            "valor-sensivel font-semibold " +
                            (margem.margemReal >= 0 ? "text-green-700" : "text-red-600")
                          }
                        >
                          {formatBRL(margem.margemReal)}
                        </span>
                        {margem.itensSemCusto.length > 0 && (
                          <span
                            className="ml-1 text-[10px] text-amber-600"
                            title={`Sem custo cadastrado: ${margem.itensSemCusto.join(", ")}`}
                          >
                            parcial
                          </span>
                        )}
                        <p className="valor-sensivel text-[10px] text-gray-400">
                          {margem.margemPct.toFixed(1)}%
                        </p>
                      </>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const rankingView = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Ranking de produtos mais vendidos (quantidade) — {rotuloPlataforma} —{" "}
          {rotuloPeriodo}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {ranking.length} produto(s) distinto(s)
          </span>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
      </div>
      <RankingProdutosTable ranking={ranking} mostrarPlataforma={mostrarPlataforma} />
    </div>
  );

  const margemView = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Margem real por pedido — {rotuloPlataforma} — {rotuloPeriodo}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {margensSelecionadas.length} pedido(s) vendido(s)
          </span>
          <RangeFilter de={de} ate={ate} plataforma={plataforma} />
        </div>
      </div>
      <AdsInvestimentoForm dia={hoje} mlInicial={adsHoje.ml} shopeeInicial={adsHoje.shopee} />
      {margensSelecionadas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhuma venda no período selecionado.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">Preço</th>
                <th className="px-4 py-3 text-right">Custo produto</th>
                <th className="px-4 py-3 text-right">Comissão</th>
                <th className="px-4 py-3 text-right">Taxa fixa</th>
                <th className="px-4 py-3 text-right">Imposto</th>
                <th className="px-4 py-3 text-right">Embalagem</th>
                <th className="px-4 py-3 text-right">Margem real</th>
                <th className="px-4 py-3 text-right">Margem %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {margensSelecionadas.map((m) => (
                <tr key={m.order.plataforma + m.order.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {mostrarPlataforma && (
                      <div className="mb-1">
                        <PlataformaBadge plataforma={m.order.plataforma} />
                      </div>
                    )}
                    #{m.order.id}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(m.order.dateCreated).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {formatBRL(m.order.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {formatBRL(m.custoProdutoTotal)}
                    {m.itensSemCusto.length > 0 && (
                      <span
                        className="ml-1 text-[10px] text-amber-600"
                        title={`Sem custo cadastrado: ${m.itensSemCusto.join(", ")}`}
                      >
                        parcial
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatBRL(m.comissao)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatBRL(m.taxaFixa)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatBRL(m.imposto)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{formatBRL(m.embalagem)}</td>
                  <td
                    className={
                      "px-4 py-3 text-right font-semibold " +
                      (m.margemReal >= 0 ? "text-green-700" : "text-red-600")
                    }
                  >
                    {formatBRL(m.margemReal)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {m.margemPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <OcultarNumeros>{resumo}</OcultarNumeros>
      <VendasTabSwitch pedidosView={pedidosView} rankingView={rankingView} margemView={margemView} />
    </div>
  );
}
