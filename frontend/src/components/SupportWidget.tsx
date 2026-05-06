'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'clubify:support:history';
const HISTORY_LIMIT = 20;
const WELCOME: Msg = {
  role: 'assistant',
  content:
    '¡Hola! 👋 Soy el asistente de Clubify. Pregúntame lo que necesites: cómo crear una tarjeta, cómo funcionan los pedidos, cómo enviar push, etc.',
};

/**
 * Widget de soporte con IA — botón flotante estilo WhatsApp + ventana de
 * chat. Usa Anthropic vía /support/ask. La base de conocimiento la edita
 * el super admin desde /admin/ai-knowledge.
 */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Carga historial cacheado al abrir por primera vez
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) setMessages(arr);
      }
    } catch {}
  }, []);

  // Persistir
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(messages.slice(-HISTORY_LIMIT)),
      );
    } catch {}
  }, [messages]);

  // Auto-scroll al fondo cuando llega un mensaje nuevo
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, open, sending]);

  // Foco al abrir
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  async function send() {
    const q = input.trim();
    if (!q || sending) return;
    // Truncamos también en memoria (no solo en localStorage) para que un chat
    // largo no degrade el render. Mantenemos siempre el WELCOME en posición 0.
    const truncated = messages.length > HISTORY_LIMIT * 2
      ? [WELCOME, ...messages.slice(-HISTORY_LIMIT)]
      : messages;
    const next: Msg[] = [...truncated, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const history = next.filter((m) => m !== WELCOME).slice(-HISTORY_LIMIT - 1, -1);
      const r = await api<{ reply: string }>('/support/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, history }),
      });
      setMessages((cur) => [...cur, { role: 'assistant', content: r.reply }]);
    } catch (e: any) {
      setMessages((cur) => [
        ...cur,
        {
          role: 'assistant',
          content:
            e?.message ||
            'No pude responder ahora. Intenta de nuevo en un momento.',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function clear() {
    setMessages([WELCOME]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  return (
    <>
      {/* Trigger flotante */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-2xl text-white transition hover:scale-105"
        style={{ background: '#25D366' }}
        title={open ? 'Cerrar asistente' : 'Asistente IA · Resolver dudas'}
        aria-label="Asistente de soporte"
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Ventana de chat — estilo WhatsApp */}
      {open && (
        <div
          className="fixed bottom-24 right-5 z-40 w-[360px] sm:w-[380px] max-h-[78vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border border-line"
          style={{ background: '#ECE5DD' }}
        >
          {/* Header WhatsApp */}
          <div
            className="flex items-center gap-3 px-4 py-3 text-white"
            style={{ background: '#075E54' }}
          >
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg">
              🤖
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">
                Asistente Clubify
              </div>
              <div className="text-[11px] opacity-80">
                {sending ? 'Escribiendo…' : 'En línea · IA'}
              </div>
            </div>
            <button
              onClick={clear}
              className="text-white/70 hover:text-white text-xs"
              title="Limpiar conversación"
            >
              🗑
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-white/70 hover:text-white text-xl leading-none"
              title="Cerrar"
            >
              ✕
            </button>
          </div>

          {/* Mensajes */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
            style={{
              backgroundImage:
                'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\' viewBox=\'0 0 80 80\'><circle cx=\'10\' cy=\'10\' r=\'1\' fill=\'%23d4cdbf\' /></svg>")',
            }}
          >
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} />
            ))}
            {sending && (
              <div className="flex">
                <div className="bg-white rounded-2xl rounded-tl-sm shadow px-3 py-2 max-w-[80%]">
                  <Typing />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="px-3 py-2.5 bg-[#F0F0F0] border-t border-line">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Escribe tu duda…"
                rows={1}
                maxLength={1000}
                disabled={sending}
                className="flex-1 resize-none rounded-2xl px-4 py-2 text-sm bg-white border-0 outline-none focus:ring-2 focus:ring-[#25D366] max-h-32"
                style={{ minHeight: 38 }}
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !input.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow disabled:opacity-50 transition"
                style={{ background: '#25D366' }}
                title="Enviar"
              >
                ➤
              </button>
            </div>
            <div className="text-[10px] text-mute text-center mt-1.5">
              Powered by IA · Las respuestas pueden tener errores
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// =============================================================
//                       Sub-componentes
// =============================================================

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-[13.5px] leading-relaxed shadow-sm whitespace-pre-wrap ${
          isUser
            ? 'rounded-2xl rounded-tr-sm text-ink'
            : 'rounded-2xl rounded-tl-sm bg-white text-ink'
        }`}
        style={isUser ? { background: '#DCF8C6' } : undefined}
      >
        {msg.content}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex gap-1.5 items-center h-5">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="w-2 h-2 bg-mute rounded-full"
          style={{
            animation: `clubifyTypingBounce 1s infinite`,
            animationDelay: `${d}ms`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes clubifyTypingBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%           { transform: scale(1);   opacity: 1;   }
        }
      `}</style>
    </div>
  );
}
