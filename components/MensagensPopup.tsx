"use client";

// Pop-up global: sempre que chegar mensagem/pergunta nova (ML ou Shopee) em
// qualquer aba do sistema, abre uma janela pra responder na hora.
// Consulta /api/mensagens a cada 45s. "Depois" dispensa aquela mensagem ate
// chegar uma nova (chave = id + data + texto), guardado no navegador.
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

interface Conversa {
  id: string;
  plataforma: "ml" | "shopee";
  tipo: "pergunta" | "posvenda" | "chat";
  titulo: string;
  comprador: string;
  ultimaMensagem: string;
  data: string;
  naoLida: boolean;
  respondida?: boolean;
  cancelada?: boolean;
}
interface Mensagem {
  id: string;
  de: "cliente" | "loja";
  texto: string;
  data: string;
}

const LS_KEY = "g3d_msgs_dispensadas";
const TIPO: Record<string, string> = { pergunta: "Pergunta", posvenda: "Pos-venda", chat: "Chat" };

function chave(c: Conversa) {
  return `${c.id}|${c.ultimaMensagem}`;
}
function lerDispensadas(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}
function salvarDispensadas(l: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(l.slice(-300)));
  } catch {
    /* ignore */
  }
}
function fmt(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function beep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 250);
  } catch {
    /* navegador pode bloquear som sem interacao */
  }
}

export default function MensagensPopup() {
  const pathname = usePathname() ?? "";
  const [fila, setFila] = useState<Conversa[]>([]);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [carregandoThread, setCarregandoThread] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(true);
  const vistos = useRef<Set<string>>(new Set());
  const tituloOriginal = useRef<string>("");

  const atual = fila[0];

  const verificar = useCallback(async () => {
    try {
      const r = await fetch("/api/mensagens", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const todas: Conversa[] = [...(j.ml?.conversas ?? []), ...(j.shopee?.conversas ?? [])];
      const dispensadas = new Set(lerDispensadas());
      const pend = todas
        .filter((c) => c.naoLida && !c.cancelada && !c.respondida && !dispensadas.has(chave(c)))
        .sort((a, b) => (a.data < b.data ? 1 : -1));
      const novas = pend.filter((c) => !vistos.current.has(chave(c)));
      if (novas.length > 0) {
        novas.forEach((c) => vistos.current.add(chave(c)));
        setAberto(true);
        beep();
      }
      setFila(pend);
    } catch {
      /* ignora falhas de rede */
    }
  }, []);

  useEffect(() => {
    tituloOriginal.current = document.title;
    verificar();
    const t = setInterval(verificar, 45000);
    return () => clearInterval(t);
  }, [verificar]);

  useEffect(() => {
    if (!tituloOriginal.current) return;
    document.title = fila.length ? `(${fila.length}) ${tituloOriginal.current}` : tituloOriginal.current;
  }, [fila.length]);

  // carrega a conversa da frente da fila
  const idAtual = atual?.id;
  useEffect(() => {
    setMsgs([]);
    setTexto("");
    setErro("");
    if (!idAtual) return;
    let cancel = false;
    setCarregandoThread(true);
    fetch(`/api/mensagens/thread?id=${encodeURIComponent(idAtual)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancel) {
          setMsgs(j.mensagens ?? []);
          if (j.erro) setErro(j.erro);
        }
      })
      .catch(() => {})
      .finally(() => !cancel && setCarregandoThread(false));
    return () => {
      cancel = true;
    };
  }, [idAtual]);

  function dispensar() {
    if (!atual) return;
    salvarDispensadas([...lerDispensadas(), chave(atual)]);
    setFila((f) => f.slice(1));
  }

  async function enviar() {
    if (!atual || !texto.trim()) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/mensagens/responder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: atual.id, texto }),
      });
      const j = await r.json();
      if (!j.ok) {
        setErro(j.erro ?? "Falha ao enviar");
        return;
      }
      salvarDispensadas([...lerDispensadas(), chave(atual)]);
      setFila((f) => f.slice(1));
      verificar();
    } finally {
      setEnviando(false);
    }
  }

  // na propria aba Mensagens a lista ja esta na tela
  if (pathname.startsWith("/mensagens")) return null;
  if (!atual) return null;

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        {fila.length} mensagem(ns) pendente(s)
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center gap-2 border-b border-gray-100 p-3">
          <span
            className={`rounded px-1.5 text-[11px] font-medium ${
              atual.plataforma === "ml" ? "bg-yellow-100 text-yellow-800" : "bg-orange-100 text-orange-800"
            }`}
          >
            {atual.plataforma === "ml" ? "ML" : "Shopee"} · {TIPO[atual.tipo]}
          </span>
          <span className="truncate text-sm font-semibold text-gray-800">{atual.titulo}</span>
          <span className="ml-auto flex-none text-xs text-gray-500">
            {fila.length > 1 ? `+${fila.length - 1} na fila` : ""}
          </span>
          <button onClick={() => setAberto(false)} className="flex-none text-gray-400 hover:text-gray-600" title="Minimizar">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ minHeight: 120 }}>
          {carregandoThread && <div className="text-sm text-gray-400">Carregando...</div>}
          {!carregandoThread && msgs.length === 0 && (
            <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800">{atual.ultimaMensagem}</div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.de === "loja" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
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

        <div className="border-t border-gray-100 p-3">
          {erro && <div className="mb-2 text-sm text-red-600">{erro}</div>}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Escreva a resposta..."
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            <a href="/mensagens" className="text-xs text-blue-600 underline">
              Abrir todas
            </a>
            <button onClick={dispensar} className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600">
              Depois
            </button>
            <button
              onClick={enviar}
              disabled={enviando || !texto.trim()}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
