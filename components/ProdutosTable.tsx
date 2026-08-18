"use client";

import { calcularCusto, formatBRL, GlobalParams, ProdutoInput } from "@/lib/custo";

interface ProdutosTableProps {
  produtos: ProdutoInput[];
  params: GlobalParams;
  onEdit: (produto: ProdutoInput) => void;
  onDelete: (id: string) => void;
  /** Pedido do Guilherme em 2026-08-18: avisar quando o SKU cadastrado
   * no Custo parece divergir do SKU real usado numa venda ainda nao
   * identificada (o vinculo automatico so funciona se o SKU bater). */
  divergencias?: Record<string, { titulo: string; sku: string }>;
}

export default function ProdutosTable({
  produtos,
  params,
  onEdit,
  onDelete,
  divergencias,
}: ProdutosTableProps) {
  if (produtos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        Nenhum produto cadastrado ainda. Use o formulário acima para adicionar
        o primeiro.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
          <tr>
            <th className="px-4 py-3">Produto</th>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Produção</th>
            <th className="px-4 py-3 text-right">Peso placa (g)</th>
            <th className="px-4 py-3 text-right">Tempo (h)</th>
            <th className="px-4 py-3 text-right">Peças/placa</th>
            <th className="px-4 py-3 text-right">Custo unitário</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {produtos.map((produto) => {
            const custo = calcularCusto(produto, params);
            return (
              <tr key={produto.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {produto.nome}
                </td>
                <td className="px-4 py-3 text-gray-500">{produto.sku || "—"}</td>
                <td className="px-4 py-3">
                  {produto.placaId ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Vinculado
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      Não vinculado
                    </span>
                  )}
                  {divergencias?.[produto.id] && (
                    <span
                      title={`Venda real "${divergencias?.[produto.id].titulo}" usa o SKU "${divergencias?.[produto.id].sku}", diferente do SKU cadastrado aqui ("${produto.sku || produto.nome}"). A venda pode continuar aparecendo como nao identificada na Producao.`}
                      className="ml-1 inline-flex cursor-help items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                    >
                      ⚠ SKU pode divergir
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{produto.pesoPlacaG}</td>
                <td className="px-4 py-3 text-right">{produto.tempoPlacaH}</td>
                <td className="px-4 py-3 text-right">{produto.pecasNaPlaca}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {formatBRL(custo.custoUnitario)}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => onEdit(produto)}
                    className="mr-3 text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDelete(produto.id)}
                    className="text-red-600 hover:underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
