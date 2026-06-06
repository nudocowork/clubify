'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };
export type SupportAudience = 'tenant' | 'affiliate';

const HISTORY_LIMIT = 20;

type AudienceConfig = {
  storageKey: string;
  triggerEmoji: string;
  triggerTitle: string;
  triggerBg: string;
  headerBg: string;
  headerName: string;
  welcome: Msg;
  suggestions: string[];
};

const AUDIENCE_CFG: Record<SupportAudience, AudienceConfig> = {
  tenant: {
    storageKey: 'clubify:support:history',
    triggerEmoji: '💬',
    triggerTitle: 'Asistente IA · Resolver dudas',
    triggerBg: '#25D366',
    headerBg: '#075E54',
    headerName: 'Asistente Clubify',
    welcome: {
      role: 'assistant',
      content:
        '¡Hola! 👋 Soy el asistente de Clubify. Pregúntame lo que necesites: cómo crear una tarjeta, cómo funcionan los pedidos, cómo enviar push, etc.',
    },
    suggestions: [
      '¿Cómo creo una tarjeta de fidelización?',
      '¿Cómo envío push notifications?',
      '¿Cómo funciona el kanban de pedidos?',
      '¿Cómo configuro un dominio propio?',
    ],
  },
  affiliate: {
    storageKey: 'clubify:support:history:affiliate',
    triggerEmoji: '🚀',
    triggerTitle: 'Mentor de ventas · Te ayudo a vender Clubify',
    triggerBg: '#7c3aed',
    headerBg: '#4c1d95',
    headerName: 'Mentor de ventas',
    welcome: {
      role: 'assistant',
      content:
        '¡Hola! 🚀 Soy tu mentor de ventas. Te ayudo a prospectar, manejar objeciones, escribir mensajes que convierten, cerrar más clientes y armar contenido para Instagram/WhatsApp. ¿En qué arrancamos?',
    },
    suggestions: [
      'Dame un script para primera llamada',
      'El cliente dice que está caro, ¿cómo respondo?',
      'Generame un mensaje WhatsApp frío',
      'Copy para Instagram Stories vendiendo Clubify',
      '¿Cómo prospectar dueños de cafeterías?',
      '¿Cómo conseguir referidos de mis clientes?',
    ],
  },
};

/**
 * Widget de soporte con IA — botón flotante + ventana de chat.
 * - audience="tenant" (default): soporte producto para dueños de negocio
 *   y staff. Tema verde WhatsApp.
 * - audience="affiliate": mentor de ventas para afiliados (influencers,
 *   embajadores). Tema violeta. Prompts pre-cargados de ventas.
 *
 * Cada audience tiene su propio localStorage key (no se mezcla historial).
 * El backend (support.service) usa `audience` para escoger system prompt
 * + filtro de knowledge entries.
 */
export function SupportWidget({
  audience = 'tenant',
}: {
  audience?: SupportAudience;
}) {
  const cfg = AUDIENCE_CFG[audience];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([cfg.welcome]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) setMessages(arr);
      }
    } catch {}
  }, [cfg.storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(
        cfg.storageKey,
        JSON.stringify(messages.slice(-HISTORY_LIMIT)),
      );
    } catch {}
  }, [messages, cfg.storageKey]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, open, sending]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open]);

  async function sendText(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const truncated =
      messages.length > HISTORY_LIMIT * 2
        ? [cfg.welcome, ...messages.slice(-HISTORY_LIMIT)]
        : messages;
    const next: Msg[] = [...truncated, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const history = next
        .filter((m) => m !== cfg.welcome)
        .slice(-HISTORY_LIMIT - 1, -1);
      const r = await api<{ reply: string }>('/support/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, history, audience }),
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

  async function send() {
    sendText(input);
  }

  function clear() {
    setMessages([cfg.welcome]);
    try {
      localStorage.removeItem(cfg.storageKey);
    } catch {}
  }

  // Mostramos sugerencias mientras el chat esté "vacío" (solo el welcome
  // o un único intercambio inicial). Después desaparecen para no estorbar.
  const showSuggestions = messages.length <= 1;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-2xl text-white transition hover:scale-105"
        style={{ background: cfg.triggerBg }}
        title={open ? 'Cerrar asistente' : cfg.triggerTitle}
        aria-label="Asistente"
      >
        {open ? '✕' : cfg.triggerEmoji}
      </button>

      {open && (
        <div
          className="fixed bottom-24 right-5 z-40 w-[360px] sm:w-[380px] max-h-[78vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden border border-line"
          style={{
            background: audience === 'affiliate' ? '#f5f3ff' : '#ECE5DD',
          }}
        >
          <div
            className="flex items-center gap-3 px-4 py-3 text-white"
            style={{ background: cfg.headerBg }}
          >
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg">
              {audience === 'affiliate' ? '🚀' : '🤖'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm leading-tight">
                {cfg.headerName}
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

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
            style={{
              backgroundImage:
                audience === 'affiliate'
                  ? undefined
                  : 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'80\' height=\'80\' viewBox=\'0 0 80 80\'><circle cx=\'10\' cy=\'10\' r=\'1\' fill=\'%23d4cdbf\' /></svg>")',
            }}
          >
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} audience={audience} />
            ))}
            {sending && (
              <div className="flex">
                <div className="bg-white rounded-2xl rounded-tl-sm shadow px-3 py-2 max-w-[80%]">
                  <Typing />
                </div>
              </div>
            )}
            {showSuggestions && !sending && (
              <div className="pt-2 flex flex-wrap gap-1.5">
                {cfg.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendText(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white border border-line hover:border-mute text-ink/80 hover:text-ink transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            className="px-3 py-2.5 border-t border-line"
            style={{
              background: audience === 'affiliate' ? '#ede9fe' : '#F0F0F0',
            }}
          >
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
                placeholder={
                  audience === 'affiliate'
                    ? 'Pregunta sobre ventas, scripts, objeciones…'
                    : 'Escribe tu duda…'
                }
                rows={1}
                maxLength={1000}
                disabled={sending}
                className="flex-1 resize-none rounded-2xl px-4 py-2 text-sm bg-white border-0 outline-none max-h-32"
                style={{
                  minHeight: 38,
                  boxShadow: `0 0 0 2px transparent`,
                }}
              />
              <button
                type="button"
                onClick={send}
                disabled={sending || !input.trim()}
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow disabled:opacity-50 transition"
                style={{ background: cfg.triggerBg }}
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

function Bubble({ msg, audience }: { msg: Msg; audience: SupportAudience }) {
  const isUser = msg.role === 'user';
  const userBg = audience === 'affiliate' ? '#ddd6fe' : '#DCF8C6';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 text-[13.5px] leading-relaxed shadow-sm whitespace-pre-wrap ${
          isUser
            ? 'rounded-2xl rounded-tr-sm text-ink'
            : 'rounded-2xl rounded-tl-sm bg-white text-ink'
        }`}
        style={isUser ? { background: userBg } : undefined}
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
