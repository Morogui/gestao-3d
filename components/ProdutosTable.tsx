"use client";

import { calcularCusto, formatBRL, GlobalParams, ProdutoInput } from "@/lib/custo";
import { useEffect, useState } from "react";

function SetaCustoDelta({ produtoId, valor }: { produtoId: string; valor: number }) {
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    if (!valor || valor <= 0 || typeof window === "undefined") return;
    const key = `gestao3d:ultimoCustoProduto:${produtoId}`;
    const prevRaw = window.localStorage.getItem(key);
    if (prevRaw !== null) {
      const prev = parseFloat(prevRaw);
      if (!isNaN(prev) && Math.abs(prev - valor) > 0.005) {
        setDelta(valor - prev);
      }
    }
    window.localStorage.setItem(key, String(valor));
  }, [produtoId, valor]);
  if (delta === null) return null;
  const subiu = delta > 0;
  return (
    <span
      title={`${subiu ? "Subiu" : "Baixou"} ${formatBRL(Math.abs(delta))} desde a ultima vez que voce viu esse custo`}
      style={{ marginLeft: 6, cursor: "help", color: subiu ? "#e05252" : "#3fae5c", fontWeight: 700, fontSize: 12 }}
    >
      {subiu ? "▲" : "▼"}
    </span>
  );
}

interface ProdutosTableProps {
  produtos: ProdutoInput[];
  params: GlobalParams;
  onEdit: (produto: ProdutoInput) => void;
  onDelete: (id: string) => void;
  /** Pedido do Guilherme em 2026-09-18: quando ele cadastra uma nova
   * variaÃ§Ã£o de cor de um produto que jÃ¡ tem a placa cadastrada (ex:
   * "STAM-01 Vermelho" usa a MESMA placa do "STAM-01 Bege"), precisa
   * ser fÃ¡cil vincular o SKU novo sem redigitar peso/tempo/peÃ§as â
   * "Nova cor" sÃ³ adiciona o SKU aos mesmos vÃ­nculos que o produto jÃ¡
   * tem (placa principal + adicionais), reaproveitando tudo. */
  onNovaCor: (produto: ProdutoInput) => void;
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
  onNovaCor,
  divergencias,
}: ProdutosTableProps) {
  if (produtos.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        Nenhum produto cadastrado ainda. Use o formulÃ¡rio acima para adicionar
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
            <th className="px-4 py-3">ProduÃ§Ã£o</th>
            <th className="px-4 py-3 text-right">Peso placa (g)</th>
            <th className="px-4 py-3 text-right">Tempo (h)</th>
            <th className="px-4 py-3 text-right">PeÃ§as/placa</th>
            <th className="px-4 py-3 text-right">Custo unitÃ¡rio</th>
            <th className="px-4 py-3 text-right">Custo unitÃ¡rio (A2L)</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {produtos.map((produto) => {
            const custo = calcularCusto(produto, params);
            const custoA2l =
              produto.pecasNaPlacaA2l && produto.pecasNaPlacaA2l > 0
                ? calcularCusto(
                    {
                      pesoPlacaG: produto.pesoPlacaA2lG || produto.pesoPlacaG,
                      tempoPlacaH: produto.tempoPlacaA2lH || produto.tempoPlacaH,
                      pecasNaPlaca: produto.pecasNaPlacaA2l,
                    },
                    params
                  ).custoUnitario
                : null;
            const numComponentes = produto.placasAdicionais?.length ?? 0;
            return (
              <tr key={produto.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {produto.nome}
                  {numComponentes > 0 && (
                    <span
                      title={`Produto composto por ${numComponentes + 1} placas: ${
                        produto.nomePlaca || produto.nome
                      }, ${produto.placasAdicionais
                        ?.map((c) => c.nome)
                        .join(", ")}`}
                      className="ml-2 inline-flex cursor-help items-center rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700"
                    >
                      composto Â· {numComponentes + 1} placas
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{produto.sku || "â"}</td>
                <td className="px-4 py-3">
                  {produto.placaId ? (
                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Vinculado
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      NÃ£o vinculado
                    </span>
                  )}
                  {divergencias?.[produto.id] && (
                    <span
                      title={`Venda real "${divergencias?.[produto.id].titulo}" usa o SKU "${divergencias?.[produto.id].sku}", diferente do SKU cadastrado aqui ("${produto.sku || produto.nome}"). A venda pode continuar aparecendo como nao identificada na Producao.`}
                      className="ml-1 inline-flex cursor-help items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
                    >
                      â  SKU pode divergir
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">{produto.pesoPlacaG}</td>
                <td className="px-4 py-3 text-right">{produto.tempoPlacaH}</td>
                <td className="px-4 py-3 text-right">{produto.pecasNaPlaca}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">
                  {formatBRL(custo.custoUnitario)}
                  <SetaCustoDelta produtoId={produto.id} valor={custo.custoUnitario} />
                </td>
                <td className="px-4 py-3 text-right text-gray-700">
                  {custoA2l !== null ? formatBRL(custoA2l) : "â"}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => onNovaCor(produto)}
                    title="Vincular uma nova cor/SKU a esta MESMA placa, sem redigitar peso/tempo/peÃ§as"
                    className="mr-3 text-emerald-600 hover:underline"
                  >
                    + Nova cor
                  </button>
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
