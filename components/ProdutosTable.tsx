"use client";

import { calcularCusto, formatBRL, GlobalParams, ProdutoInput } from "@/lib/custo";

interface ProdutosTableProps {
  produtos: ProdutoInput[];
  params: GlobalParams;
  onEdit: (produto: ProdutoInput) => void;
  onDelete: (id: string) => void;
}

export default function ProdutosTable({
  produtos,
  params,
  onEdit,
  onDelete,
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
