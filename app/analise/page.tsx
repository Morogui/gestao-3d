import { getAnaliseAnuncios } from "@/lib/ml-analise";
import { getConcorrencia } from "@/lib/concorrencia";
import { getCategoriaTier } from "@/lib/categoria-tier";
import AnaliseAnunciosTable from "@/components/AnaliseAnunciosTable";
import ConcorrenciaTable from "@/components/ConcorrenciaTable";
import CategoriaTierSection from "@/components/CategoriaTierSection";

export const dynamic = "force-dynamic";

export default async function AnalisePage() {
  const resultado = await getAnaliseAnuncios();
  const concorrencia = await getConcorrencia();
  const categoriaTier = await getCategoriaTier();

  const secaoConcorrencia = (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Concorrência (Full ML)
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Preço, fotos e vendas comparados com o concorrente direto de cada
          produto. Atualiza sozinho todo dia às 5h30.
        </p>
      </div>
      <ConcorrenciaTable linhas={concorrencia} />
    </div>
  );

  // Categoria (Tier) — pedido do Guilherme em 2026-09-17: movida pra cá
  // da aba Full (ver components/CategoriaTierSection.tsx e
  // lib/categoria-tier.ts). Não depende da sessão da ML (é tudo dado do
  // nosso catálogo), então aparece mesmo se o ML estiver desconectado.
  const secaoCategoriaTier = (
    <CategoriaTierSection
      fullMercadoLivre={categoriaTier.fullMercadoLivre}
      geralMlShopee={categoriaTier.geralMlShopee}
    />
  );

  if (!resultado.connected) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800">
          Mercado Livre não conectado ou sessão expirada.{" "}
          <a href="/api/mercadolivre/authorize" className="font-medium underline">
            Conectar Mercado Livre
          </a>
        </div>
        {secaoCategoriaTier}
        {secaoConcorrencia}
      </div>
    );
  }

  if (resultado.error) {
    return (
      <div className="space-y-6">
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          Não consegui buscar os anúncios agora (erro na API do Mercado Livre
          ou sessão expirada).{" "}
          <a href="/api/mercadolivre/authorize" className="font-medium underline">
            Reconectar Mercado Livre
          </a>
        </div>
        {secaoCategoriaTier}
        {secaoConcorrencia}
      </div>
    );
  }

  const { totalAnuncios, totalVariacoes, grupos } = resultado;
  const nuncaVenderam = grupos.filter((g) => g.diasSemVenda === null).length;
  const semVenda30 = grupos.filter(
    (g) => g.diasSemVenda !== null && g.diasSemVenda >= 30
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">
          Análise — Mercado Livre
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalAnuncios} anúncios ativos ({totalVariacoes} SKUs no total).
          Clique no + para ver as variações de cada anúncio.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-sm text-gray-500">Anúncios ativos</p>
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

      <AnaliseAnunciosTable grupos={grupos} />

      {secaoCategoriaTier}

      {secaoConcorrencia}
    </div>
  );
}
