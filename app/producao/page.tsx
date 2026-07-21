"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadParams, loadProdutos } from "@/lib/storage";
import { calcularFilaDeProducao, ItemParaImprimir } from "@/lib/producao";
import { formatBRL } from "@/lib/custo";
import { todaySP, formatDiaBR } from "@/lib/date";
import type { OrdersResult } from "@/lib/ml-orders";

type Status = "loading" | "ready" | "erro" | "desconectado";

export default function ProducaoPage() {
  const [selectedDay, setSelectedDay] = useState(todaySP());
  const [inputDay, setInputDay] = useState(todaySP());
  const [status, setStatus] = useState<Status>("loading");
  const [casados, setCasados] = useState<ItemParaImprimir[]>([]);
  const [semCadastro, setSemCadastro] = useState<ItemParaImprimir[]>([]);
  const [totalPedidos, setTotalPedidos] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setStatus("loading");

    fetch(`/api/mercadolivre/orders?data=${selectedDay}`)
      .then((r) => r.json())
      .then((result: OrdersResult) => {
        if (cancelado) return;
        if (!result.connected) {
          setStatus("desconectado");
          return;
        }
        if (result.error) {
          setStatus("erro");
          return;
        }
        const produtos = loadProdutos();
        const params = loadParams();
        const fila = calcularFilaDeProducao(result.orders, produtos, params);
        setCasados(fila.casados);
        setSemCadastro(fila.semCadastro);
        setTotalPedidos(result.orders.length);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelado) setStatus("erro");
      });

    return () => {
      cancelado = true;
    };
  }, [selectedDay]);

  if (status === "desconectado") {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="mb-2 font-medium text-gray-900">
          Conecte a aba Vendas primeiro
        </p>
        <p className="mb-4 text-sm text-gray-500">
          A Produção usa os pedidos da aba Vendas — conecte sua conta do
          Mercado Livre por lá antes de continuar.
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

  const totalPecas =
    casados.reduce((s, i) => s + i.quantidade, 0) +
    semCadastro.reduce((s, i) => s + i.quantidade, 0);
  const custoTotalCasados = casados.reduce((s, i) => s + i.custoTotal, 0);
  const vazio = casados.length === 0 && semCadastro.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Fila de produção — {formatDiaBR(selectedDay)}
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="data-producao" className="text-xs font-medium text-gray-500">
            Data
          </label>
          <input
            type="date"
            id="data-producao"
            value={inputDay}
            max={todaySP()}
            onChange={(e) => setInputDay(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => setSelectedDay(inputDay)}
            className="rounded-md bg-gray-900 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700"
          >
            Buscar
          </button>
        </div>
      </div>

      {status === "loading" && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Carregando pedidos...
        </div>
      )}

      {status === "erro" && (
        <div className="rounded-lg border border-dashed border-red-300 bg-white p-8 text-center text-red-600">
          Não deu pra carregar os pedidos — a sessão da ML pode ter expirado.
          Reconecte na aba Vendas.
        </div>
      )}

      {status === "ready" && vazio && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Nenhum pedido em {formatDiaBR(selectedDay)}.
        </div>
      )}

      {status === "ready" && !vazio && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Pedidos no dia</p>
              <p className="text-xl font-semibold text-gray-900">{totalPedidos}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">Peças a imprimir</p>
              <p className="text-xl font-semibold text-gray-900">{totalPecas}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs text-gray-500">
                Custo estimado (produtos cadastrados)
              </p>
              <p className="text-xl font-semibold text-gray-900">
                {formatBRL(custoTotalCasados)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full table-fixed divide-y divide-gray-200 text-sm">
              <colgroup>
                <col className="w-[46%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Produto (Custo)</th>
                  <th className="px-4 py-3 text-right">Qtd. a imprimir</th>
                  <th className="px-4 py-3 text-right">Custo unitário</th>
                  <th className="px-4 py-3 text-right">Custo total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {casados.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                      Nenhum item vendido bateu com produtos cadastrados na
                      aba Custo ainda.
                    </td>
                  </tr>
                ) : (
                  casados.map((item) => (
                    <tr key={item.chave}>
                      <td className="truncate px-4 py-3 text-gray-900">
                        {item.titulo}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {item.quantidade}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {formatBRL(item.custoUnitario)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {formatBRL(item.custoTotal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {semCadastro.length > 0 && (
            <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase text-amber-700">
                Vendidos mas sem produto cadastrado no Custo ({semCadastro.length})
              </p>
              <ul className="flex flex-col gap-1 text-sm text-amber-900">
                {semCadastro.map((item) => (
                  <li key={item.chave} className="flex justify-between gap-4">
                    <span className="truncate">{item.titulo}</span>
                    <span className="flex-shrink-0 font-semibold">
                      x{item.quantidade}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-700">
                Cadastre esses produtos na aba Custo usando um nome/código que
                apareça no título do anúncio, pra eles entrarem no cálculo
                aqui da próxima vez.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
