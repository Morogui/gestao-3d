import { getOrders } from "@/lib/ml-orders";
import { formatBRL } from "@/lib/custo";
import { labelOrderStatus } from "@/lib/mercadolivre";
import ItemThumbnail from "@/components/ItemThumbnail";

export const dynamic = "force-dynamic";

// Data de hoje no fuso de São Paulo (UTC-3), no formato aceito pelo
// <input type="date"> (YYYY-MM-DD). Usado como padrão do filtro.
function todaySP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

export default async function VendasPage({
  searchParams,
}: {
  searchParams: { erro?: string; data?: string };
}) {
  const selectedDay = searchParams.data || todaySP();
  const result = await getOrders(selectedDay);

  if (!result.connected) {
    return <ConnectCard erro={searchParams.erro} />;
  }

  if (result.error) {
    return (
      <ConnectCard erro="sessão expirada, reconecte" />
    );
  }

  const dataFormatada = new Date(`${selectedDay}T12:00:00-03:00`).toLocaleDateString(
    "pt-BR"
  );

  if (result.orders.length === 0) {
    return (
      <div className="flex flex-col gap-4">
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
        <table className="min-w-full divide-y divide-gray-200 text-sm">
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
                <td className="px-4 py-3">{order.buyerNickname}</td>
                <td className="px-4 py-3 text-gray-500">
                  <div className="flex flex-col gap-2">
                    {order.items.map((item, idx) => (
                      <div key={`${item.itemId}-${idx}`} className="flex items-center gap-2">
                        <ItemThumbnail src={item.thumbnail} alt={item.title} />
                        <div className="min-w-0">
                          <p className="truncate text-gray-900">
                            {item.title} x{item.quantity}
                          </p>
                          <p className="text-xs text-gray-400">
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
