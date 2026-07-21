import { getOrders, getOrdersRange, OrdersResult } from "@/lib/ml-orders";
import { formatBRL } from "@/lib/custo";
import { labelOrderStatus } from "@/lib/mercadolivre";
import { todaySP, formatDiaBR, diasAtras, inicioDoMes } from "@/lib/date";
import ItemThumbnail from "@/components/ItemThumbnail";

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

function DateFilter({ selectedDay }: { selectedDay: string }) {
  return (
    <form className="flex items-center gap-2" method="GET">
      <label htmlFor="data" className="text-xs font-medium text-gray-500">
        Data
      </label>
      <input
        type="date"
        id="data"
        name="data"
        defaultValue={selectedDay}
        max={todaySP()}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700"
      >
        Buscar
      </button>
    </form>
  );
}

// Extrai contagem de pedidos + faturamento total de um resultado de
// pedidos, tolerante a estados de erro/desconectado (fica em 0/0).
function resumoStats(result: OrdersResult): { pedidos: number; faturamento: number } {
  if (!result.connected || result.error) return { pedidos: 0, faturamento: 0 };
  return {
    pedidos: result.orders.length,
    faturamento: result.orders.reduce((soma, o) => soma + o.totalAmount, 0),
  };
}

function ResumoCard({ label, pedidos, faturamento }: { label: string; pedidos: number; faturamento: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900">{formatBRL(faturamento)}</p>
      <p className="text-xs text-gray-400">{pedidos} pedido(s)</p>
    </div>
  );
}

export default async function VendasPage({
  searchParams,
}: {
  searchParams: { erro?: string; data?: string };
}) {
  const hoje = todaySP();
  const selectedDay = searchParams.data || hoje;
  const result = await getOrders(selectedDay);

  if (!result.connected) {
    return <ConnectCard erro={searchParams.erro} />;
  }

  if (result.error) {
    return (
      <ConnectCard erro="sessão expirada, reconecte" />
    );
  }

  // Resumo do dia/semana/mês — sempre relativo a hoje, independente do
  // filtro de data usado na tabela detalhada abaixo. Reaproveita a
  // consulta já feita se o filtro estiver em "hoje", pra não duplicar
  // chamada à API da ML.
  const semanaInicio = diasAtras(hoje, 6);
  const mesInicio = inicioDoMes(hoje);
  const [resultDia, resultSemana, resultMes] = await Promise.all([
    selectedDay === hoje ? Promise.resolve(result) : getOrders(hoje),
    getOrdersRange(semanaInicio, hoje),
    getOrdersRange(mesInicio, hoje),
  ]);
  const resumoDia = resumoStats(resultDia);
  const resumoSemana = resumoStats(resultSemana);
  const resumoMes = resumoStats(resultMes);

  const dataFormatada = formatDiaBR(selectedDay);

  const resumo = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <ResumoCard label="Vendas de hoje" pedidos={resumoDia.pedidos} faturamento={resumoDia.faturamento} />
      <ResumoCard label="Vendas na semana (últimos 7 dias)" pedidos={resumoSemana.pedidos} faturamento={resumoSemana.faturamento} />
      <ResumoCard label="Vendas no mês" pedidos={resumoMes.pedidos} faturamento={resumoMes.faturamento} />
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
          <DateFilter selectedDay={selectedDay} />
        </div>
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhum pedido em {dataFormatada}.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resumo}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Pedidos — Mercado Livre — {dataFormatada}
        </h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">
            {result.orders.length} pedido(s)
          </span>
          <DateFilter selectedDay={selectedDay} />
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
}
