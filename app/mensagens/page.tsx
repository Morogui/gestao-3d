"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Conversa {
  id: string;
  plataforma: "ml" | "shopee";
  tipo: "pergunta" | "posvenda" | "chat";
  titulo: string;
  comprador: string;
  ultimaMensagem: string;
  data: string;
  naoLida: boolean;
  thumbnail?: string | null;
  respondida?: boolean;
  cancelada?: boolean;
  mediacao?: boolean;
}
interface Mensagem {
  id: string;
  de: "cliente" | "loja";
  texto: string;
  data: string;
}
interface Lista {
  conectado: boolean;
  erro?: string;
  conversas: Conversa[];
}

type Filtro = "todas" | "ml" | "shopee" | "mediacao";

const TIPO_LABEL: Record<string, string> = {
  pergunta: "Pergunta",
  posvenda: "Pos-venda",
  chat: "Chat",
};

function fmt(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function MensagensPage() {
  const [ml, setMl] = useState<Lista | null>(null);
  const [shopee, setShopee] = useState<Lista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [soPendentes, setSoPendentes] = useState(false);
  const [sel, setSel] = useState<Conversa | null>(null);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [contexto, setContexto] = useState<string>("");
  const [erroThread, setErroThread] = useState<string>("");
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/mensagens", { cache: "no-store" });
      const j = await r.json();
      setMl(j.ml);
      setShopee(j.shopee);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60000);
    return () => clearInterval(t);
  }, [carregar]);

  const todas = useMemo(() => {
    const l = [...(ml?.conversas ?? []), ...(shopee?.conversas ?? [])];
    return l
      .filter((c) => (filtro === "mediacao" ? !!c.mediacao : !c.mediacao))
      .filter((c) => (filtro === "todas" || filtro === "mediacao" ? true : c.plataforma === filtro))
      .filter((c) => (soPendentes ? c.naoLida : true))
      .sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [ml, shopee, filtro, soPendentes]);

  const nMed = (ml?.conversas ?? []).filter((c) => c.mediacao).length;
  const pendentesML = (ml?.conversas ?? []).filter((c) => c.naoLida && !c.mediacao).length;
  const pendentesShopee = (shopee?.conversas ?? []).filter((c) => c.naoLida).length;

  async function abrir(c: Conversa) {
    setSel(c);
    setMsgs([]);
    setContexto("");
    setErroThread("");
    setErroEnvio("");
    setTexto("");
    setCarregandoThread(true);
    try {
      const r = await fetch(`/api/mensagens/thread?id=${encodeURIComponent(c.id)}`, { cache: "no-store" });
      const j = await r.json();
      setMsgs(j.mensagens ?? []);
      setContexto(j.contexto ?? "");
      setErroThread(j.erro ?? "");
    } finally {
      setCarregandoThread(false);
    }
  }

  async function enviar() {
    if (!sel || !texto.trim()) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      const r = await fetch("/api/mensagens/responder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.id, texto }),
      });
      const j = await r.json();
      if (!j.ok) {
        setErroEnvio(j.erro ?? "Falha ao enviar");
        return;
      }
      setTexto("");
      await abrir(sel);
      carregar();
    } finally {
      setEnviando(false);
    }
  }

  const erros = [
    ml && !ml.conectado ? "Mercado Livre desconectado" : ml?.erro,
    shopee && !shopee.conectado ? "Shopee desconectada" : shopee?.erro,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Mensagens</h1>
        <div className="flex gap-1">
          {(
            [
              ["todas", "Todas"],
              ["ml", `Mercado Livre${pendentesML ? ` (${pendentesML})` : ""}`],
              ["shopee", `Shopee${pendentesShopee ? ` (${pendentesShopee})` : ""}`],
              ["mediacao", "Mediação" + (nMed ? " (" + nMed + ")" : "")],
            ] as [Filtro, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              className={`rounded-md px-3 py-1 text-sm border ${
                filtro === k ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
          So pendentes
        </label>
        <button onClick={carregar} className="ml-auto rounded-md border border-gray-300 px-3 py-1 text-sm">
          {carregando ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {erros.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {erros.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[380px_1fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white">
          {todas.length === 0 && !carregando && (
            <div className="p-4 text-sm text-gray-500">Nenhuma mensagem.</div>
          )}
          {todas.map((c) => (
            <button
              key={c.id}
              onClick={() => abrir(c)}
              className={`flex w-full gap-3 border-b border-gray-100 p-3 text-left hover:bg-gray-50 ${
                sel?.id === c.id ? "bg-blue-50" : ""
              }`}
            >
              {c.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt="" className="h-10 w-10 flex-none rounded object-cover" />
              ) : (
                <div className="h-10 w-10 flex-none rounded bg-gray-100" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 text-[10px] font-medium ${
                      c.plataforma === "ml" ? "bg-yellow-100 text-yellow-800" : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {c.plataforma === "ml" ? "ML" : "Shopee"} · {c.mediacao ? "Mediação" : TIPO_LABEL[c.tipo]}
                  </span>
                  {c.naoLida && <span className="h-2 w-2 rounded-full bg-red-500" />}
                  <span className="ml-auto text-[11px] text-gray-400">{fmt(c.data)}</span>
                </div>
                <div className="truncate text-sm font-medium text-gray-800">{c.titulo}</div>
                <div className="truncate text-xs text-gray-500">{c.ultimaMensagem}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex min-h-[50vh] flex-col rounded-md border border-gray-200 bg-white">
          {!sel ? (
            <div className="m-auto text-sm text-gray-400">Selecione uma conversa</div>
          ) : (
            <>
              <div className="border-b border-gray-100 p-3">
                <div className="text-sm font-medium">{sel.titulo}</div>
                <div className="text-xs text-gray-500">
                  {sel.plataforma === "ml" ? "Mercado Livre" : "Shopee"} · {sel.comprador}
                  {contexto && contexto !== sel.titulo ? ` · ${contexto}` : ""}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "50vh" }}>
                {carregandoThread && <div className="text-sm text-gray-400">Carregando...</div>}
                {erroThread && <div className="text-sm text-red-600">{erroThread}</div>}
                {msgs.map((m) => (
                  <div key={m.id} className={`flex ${m.de === "loja" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                        m.de === "loja" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {m.texto}
                      <div className={`mt-1 text-[10px] ${m.de === "loja" ? "text-blue-100" : "text-gray-400"}`}>
                        {fmt(m.data)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {sel.mediacao ? (
                <div className="border-t border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Pedido em mediação/reclamação: o Mercado Livre bloqueia o chat normal. Responda pela reclamação no painel do ML (Vendas → Reclamações).
                </div>
              ) : (
              <div className="border-t border-gray-100 p-3">
                {erroEnvio && <div className="mb-2 text-sm text-red-600">{erroEnvio}</div>}
                <div className="flex gap-2">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={3}
                    placeholder={
                      sel.cancelada
                        ? "Pedido cancelado - o ML nao permite responder"
                        : sel.respondida
                        ? "Pergunta ja respondida"
                        : "Escreva a resposta..."
                    }
                    disabled={sel.respondida || sel.cancelada}
                    className="flex-1 rounded-md border border-gray-300 p-2 text-sm"
                  />
                  <button
                    onClick={enviar}
                    disabled={enviando || !texto.trim() || sel.respondida || sel.cancelada}
                    className="self-end rounded-md bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {enviando ? "Enviando..." : "Enviar"}
                  </button>
                </div>
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
