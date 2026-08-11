import { getAnaliseAnuncios } from "@/lib/ml-analise";

export const dynamic = "force-dynamic";

function formatarData(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default async function AnalisePage() {
  const resultado = await getAnaliseAnuncios();

if (!resultado.connected) {
  return (
    <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
    Mercado Livre nao conectado ou sessao expirada.{" "}
    <a href="/api/mercadolivre/authorize" className="font-medium underline">
    Conectar Mercado Livre
    </a>
    </div>
    );
}
  
  if (resultado.error) {
    return (
      <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
      Nao consegui buscar os anuncios agora (erro na API do Mercado Livre
      ou sessao expirada).{" "}
      <a href="/api/mercadolivre/authorize" className="font-medium underline">
      Reconectar Mercado Livre
      </a>
      </div>
      );
  }
  
  const { totalAnuncios, anuncios } = resultado;
  const nuncaVenderam = anuncios.filter((a) => a.diasSemVenda === null).length;
  const semVenda30 = anuncios.filter(
    (a) => a.diasSemVenda !== null && a.diasSemVenda >= 30
      ).length;
  
  return (
    <div className="space-y-6">
    <div>
    <h1 className="text-lg font-semibold text-gray-900">
    Analise - Mercado Livre
    </h1>
    <p className="mt-1 text-sm text-gray-500">
    Anuncios ativos na conta, data de criacao e dias sem vendas.
    </p>
    </div>
    
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <div className="rounded-md border border-gray-200 bg-white p-4">
    <p className="text-sm text-gray-500">Anuncios ativos</p>
    <p className="mt-1 text-2xl font-semibold text-gray-900">
      {totalAnuncios}
    </p>
    </div>
    <div className="rounded-md border border-gray-200 bg-white p-4">
    <p className="text-sm text-gray-500">Nunca venderam</p>
    <p className="mt-1 text-2xl font-semibold text-gray-900">
      {nuncaVenderam}
    </p>
    </div>
    <div className="rounded-md border border-gray-200 bg-white p-4">
    <p className="text-sm text-gray-500">30+ dias sem venda</p>
    <p className="mt-1 text-2xl font-semibold text-gray-900">
      {semVenda30}
    </p>
    </div>
    </div>
    
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
    <table className="min-w-full text-sm">
    <thead className="bg-gray-50 text-left text-gray-500">
    <tr>
    <th className="px-4 py-2 font-medium">Anuncio</th>
    <th className="px-4 py-2 font-medium">SKU</th>
    <th className="px-4 py-2 font-medium">Criado em</th>
    <th className="px-4 py-2 font-medium">Ultima venda</th>
    <th className="px-4 py-2 font-medium">Dias sem venda</th>
    </tr>
    </thead>
    <tbody>
      {anuncios.map((a) => (
      <tr key={a.itemId} className="border-t border-gray-100">
      <td className="px-4 py-2">
        {a.permalink ? (
        <a
          href={a.permalink}
          target="_blank"
          rel="noreferrer"
          className="text-blue-600 hover:underline"
          >
          {a.title}
        </a>
        ) : (
        a.title
        )}
      <div className="text-xs text-gray-400">{a.itemId}</div>
      </td>
      <td className="px-4 py-2 text-gray-700">{a.sku}</td>
      <td className="px-4 py-2 text-gray-700">
        {formatarData(a.dateCreated)}
      </td>
      <td className="px-4 py-2 text-gray-700">
        {a.ultimaVendaEm ? formatarData(a.ultimaVendaEm) : "Nunca vendeu"}
      </td>
      <td className="px-4 py-2 font-medium text-gray-900">
        {a.diasSemVenda === null
          ? `${a.diasDesdeCriacao} (desde a criacao)`
          : a.diasSemVenda}
      </td>
      </tr>
      ))}
      {anuncios.length === 0 && (
      <tr>
      <td className="px-4 py-6 text-center text-gray-400" colSpan={5}>
      Nenhum anuncio ativo encontrado.
      </td>
      </tr>
      )}
    </tbody>
    </table>
    </div>
    </div>
    );
}
