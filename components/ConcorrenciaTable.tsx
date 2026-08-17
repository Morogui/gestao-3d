import type { LinhaConcorrencia } from "@/lib/concorrencia";

// Secao "Concorrencia" da aba Analise - mostra, produto a produto, como a
// MOROLAR esta em relacao ao concorrente direto mais relevante no ML.
// Dados vem de lib/concorrencia.ts (tabela concorrencia), preenchidos no
// levantamento inicial e depois atualizados sozinhos pelo cron diario.

function formatarPreco(v: number | null): string {
  if (v === null) return "\u2014";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string | null): string {
  if (!iso) return "\u2014";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const RISCO_ESTILO: Record<string, string> = {
  alto: "bg-red-50 text-red-700 border-red-200",
  medio: "bg-yellow-50 text-yellow-700 border-yellow-200",
  baixo: "bg-green-50 text-green-700 border-green-200",
  nenhum: "bg-gray-50 text-gray-500 border-gray-200",
};

const RISCO_TEXTO: Record<string, string> = {
  alto: "Risco alto",
  medio: "Risco médio",
  baixo: "Risco baixo",
  nenhum: "Sem risco",
};

function BadgeRisco({ risco }: { risco: string | null }) {
  const chave = risco && RISCO_ESTILO[risco] ? risco : "nenhum";
  const classe = "inline-block rounded-full border px-2 py-0.5 text-xs font-medium " + RISCO_ESTILO[chave];
  return <span className={classe}>{RISCO_TEXTO[chave]}</span>;
}

export default function ConcorrenciaTable({
  linhas,
}: {
  linhas: LinhaConcorrencia[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Produto</th>
            <th className="px-4 py-2 font-medium">Preço nosso</th>
            <th className="px-4 py-2 font-medium">Preço concorrente</th>
            <th className="px-4 py-2 font-medium">Fotos (nós / concorrente)</th>
            <th className="px-4 py-2 font-medium">Vendidos (nós / concorrente)</th>
            <th className="px-4 py-2 font-medium">Risco</th>
            <th className="px-4 py-2 font-medium">Atualizado em</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-t border-gray-100 align-top">
              <td className="px-4 py-2">
                <div className="font-medium text-gray-900">{l.produtoNome}</div>
                {l.concorrenteTitulo ? (
                  <div className="text-xs text-gray-400">
                    vs.{" "}
                    {l.concorrenteUrl ? (
                      <a
                        href={l.concorrenteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {l.concorrenteTitulo}
                      </a>
                    ) : (
                      l.concorrenteTitulo
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">
                    Nenhum concorrente direto identificado
                  </div>
                )}
                {l.observacao ? (
                  <div className="mt-1 text-xs text-gray-500">{l.observacao}</div>
                ) : null}
              </td>
              <td className="px-4 py-2 text-gray-700">{formatarPreco(l.nossoPreco)}</td>
              <td className="px-4 py-2 text-gray-700">
                {formatarPreco(l.concorrentePreco)}
              </td>
              <td className="px-4 py-2 text-gray-700">
                {l.nossoFotos ?? "\u2014"} / {l.concorrenteFotos ?? "\u2014"}
              </td>
              <td className="px-4 py-2 text-gray-700">
                {l.nossoVendidosLabel ?? "\u2014"} / {l.concorrenteVendidosLabel ?? "\u2014"}
              </td>
              <td className="px-4 py-2">
                <BadgeRisco risco={l.risco} />
              </td>
              <td className="px-4 py-2 text-xs text-gray-400">
                {formatarData(l.atualizadoEm)}
              </td>
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center text-gray-400" colSpan={7}>
                Nenhum dado de concorrência cadastrado ainda.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
