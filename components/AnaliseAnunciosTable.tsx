"use client";

import { useState } from "react";
import type { GrupoAnaliseAnuncio } from "@/lib/ml-analise";

function formatarData(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("pt-BR");
}

function TextoDiasSemVenda({
    diasSemVenda,
    diasDesdeCriacao,
}: {
    diasSemVenda: number | null;
    diasDesdeCriacao: number;
}) {
    if (diasSemVenda === null) {
          return <span>{diasDesdeCriacao} (desde a criação)</span>;
    }
    return <span>{diasSemVenda}</span>;
}

export default function AnaliseAnunciosTable({
    grupos,
}: {
    grupos: GrupoAnaliseAnuncio[];
}) {
    const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  
    function alternarExpandido(chave: string) {
          setExpandidos((atual) => {
                  const novo = new Set(atual);
                  if (novo.has(chave)) {
                            novo.delete(chave);
                  } else {
                            novo.add(chave);
                  }
                  return novo;
          });
    }
  
    return (
          <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
                <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-gray-500">
                                  <tr>
                                              <th className="px-4 py-2 font-medium"></th>
                                              <th className="px-4 py-2 font-medium">Anúncio</th>
                                              <th className="px-4 py-2 font-medium">Criado em</th>
                                              <th className="px-4 py-2 font-medium">Última venda</th>
                                              <th className="px-4 py-2 font-medium">Dias sem venda</th>
                                  </tr>
                        </thead>
                        <tbody>
                          {grupos.flatMap((g) => {
                        const aberto = expandidos.has(g.chave);
                        const unico = g.totalVariacoes === 1 ? g.variacoes[0] : null;
                        const linhas = [
                                        <tr key={g.chave} className="border-t border-gray-100">
                                                        <td className="px-4 py-2 align-top">
                                                          {g.totalVariacoes > 1 ? (
                                                              <button
                                                                                      type="button"
                                                                                      onClick={() => alternarExpandido(g.chave)}
                                                                                      className="flex h-6 w-6 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100"
                                                                                      aria-label={aberto ? "Recolher variações" : "Expandir variações"}
                                                                                    >
                                                                {aberto ? "−" : "+"}
                                                              </button>
                                                            ) : null}
                                                        </td>
                                                        <td className="px-4 py-2">
                                                                          <div className="font-medium text-gray-900">{g.titulo}</div>
                                                          {g.totalVariacoes > 1 ? (
                                                              <div className="text-xs text-gray-400">
                                                                {g.totalVariacoes} variações (SKUs)
                                                              </div>
                                                            ) : (
                                                              <div className="text-xs text-gray-400">
                                                                {unico?.permalink ? (
                                                                                        <a
                                                                                                                    href={unico.permalink}
                                                                                                                    target="_blank"
                                                                                                                    rel="noreferrer"
                                                                                                                    className="text-blue-600 hover:underline"
                                                                                                                  >
                                                                                          {unico.sku ?? "-"}
                                                                                          </a>
                                                                                      ) : (
                                                                                        unico?.sku ?? "-"
                                                                                      )}
                                                                {unico?.itemId ? <span> · {unico.itemId}</span> : null}
                                                              </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-gray-700">
                                                          {formatarData(g.dateCreatedMaisAntiga)}
                                                        </td>
                                                        <td className="px-4 py-2 text-gray-700">
                                                          {g.ultimaVendaEm ? formatarData(g.ultimaVendaEm) : "Nunca vendeu"}
                                                        </td>
                                                        <td className="px-4 py-2 font-medium text-gray-900">
                                                                          <TextoDiasSemVenda
                                                                                                diasSemVenda={g.diasSemVenda}
                                                                                                diasDesdeCriacao={g.diasDesdeCriacaoGrupo}
                                                                                              />
                                                        </td>
                                        </tr>,
                                      ];
            
                        if (aberto) {
                                        for (const v of g.variacoes) {
                                                          linhas.push(
                                                                              <tr key={v.itemId} className="border-t border-gray-50 bg-gray-50/60">
                                                                                                  <td className="px-4 py-2"></td>
                                                                                                  <td className="px-4 py-2 pl-8">
                                                                                                    {v.permalink ? (
                                                                                                        <a
                                                                                                                                    href={v.permalink}
                                                                                                                                    target="_blank"
                                                                                                                                    rel="noreferrer"
                                                                                                                                    className="text-blue-600 hover:underline"
                                                                                                                                  >
                                                                                                          {v.sku}
                                                                                                          </a>
                                                                                                      ) : (
                                                                                                        v.sku
                                                                                                      )}
                                                                                                                        <div className="text-xs text-gray-400">{v.itemId}</div>
                                                                                                    </td>
                                                                                                  <td className="px-4 py-2 text-gray-700">
                                                                                                    {formatarData(v.dateCreated)}
                                                                                                    </td>
                                                                                                  <td className="px-4 py-2 text-gray-700">
                                                                                                    {v.ultimaVendaEm ? formatarData(v.ultimaVendaEm) : "Nunca vendeu"}
                                                                                                    </td>
                                                                                                  <td className="px-4 py-2 font-medium text-gray-900">
                                                                                                                        <TextoDiasSemVenda
                                                                                                                                                  diasSemVenda={v.diasSemVenda}
                                                                                                                                                  diasDesdeCriacao={v.diasDesdeCriacao}
                                                                                                                                                />
                                                                                                    </td>
                                                                              </tr>
                                                                            );
                                        }
                        }
            
                        return linhas;
          })}
                          {grupos.length === 0 && (
                        <tr>
                                      <td className="px-4 py-6 text-center text-gray-400" colSpan={5}>
                                                      Nenhum anúncio ativo encontrado.
                                      </td>
                        </tr>
                      )}
                        </tbody>
                </table>
          </div>
        );
}
