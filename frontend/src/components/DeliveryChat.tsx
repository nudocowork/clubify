'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ChatRole = 'CUSTOMER' | 'BUSINESS' | 'COMPANY';
export type ChatMessage = {
  id: string;
  senderRole: ChatRole;
  senderName: string | null;
  body: string;
  createdAt: string;
};

const ROLE_LABEL: Record<ChatRole, string> = {
  CUSTOMER: 'Cliente',
  BUSINESS: 'Negocio',
  COMPANY: 'Domicilios',
};

/**
 * Chat del domicilio (Fase 3B). Reutilizable por las 3 superficies: el cliente
 * (/o/[code]), el negocio (/app/orders/[id]) y la empresa (/domicilios).
 * Cada superficie pasa su propio load/send (público o autenticado) y su rol.
 */
export function DeliveryChat({
  load,
  send,
  meRole,
  primary = '#0ea5e9',
  pollMs = 12000,
  heightPx = 320,
}: {
  load: () => Promise<ChatMessage[]>;
  send: (body: string) => Promise<ChatMessage[] | void>;
  meRole: ChatRole;
  primary?: string;
  pollMs?: number;
  heightPx?: number;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const msgs = await load();
      setMessages(msgs ?? []);
    } catch {
      /* noop */
    } finally {
      setLoaded(true);
    }
  }, [load]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function submit() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    try {
      const updated = await send(body);
      if (Array.isArray(updated)) setMessages(updated);
      else await refresh();
    } catch (e: any) {
      setText(body);
      alert(e?.message ?? 'No se pudo enviar.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      <div
        ref={scrollRef}
        className="overflow-y-auto p-3 space-y-2"
        style={{ height: heightPx, background: '#f8fafc' }}
      >
        {loaded && messages.length === 0 && (
          <div className="text-center text-[13px] text-gray-400 py-8">
            Aún no hay mensajes. Escribe el primero 👇
          </div>
        )}
        {messages.map((m) => {
          const mine = m.senderRole === meRole;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[82%]">
                {!mine && (
                  <div className="text-[10.5px] font-semibold mb-0.5 px-1" style={{ color: '#64748b' }}>
                    {m.senderName || ROLE_LABEL[m.senderRole]}{' '}
                    <span style={{ opacity: 0.6 }}>· {ROLE_LABEL[m.senderRole]}</span>
                  </div>
                )}
                <div
                  className="px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap"
                  style={
                    mine
                      ? { background: primary, color: 'white', borderRadius: '14px 14px 4px 14px' }
                      : { background: 'white', color: '#111827', border: '1px solid #e5e7eb', borderRadius: '14px 14px 14px 4px' }
                  }
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 p-2" style={{ background: 'white', borderTop: '1px solid #eef0f2' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Escribe un mensaje…"
          className="flex-1 rounded-[10px] px-3 py-2.5 text-sm outline-none border border-gray-300 focus:border-gray-500"
          maxLength={1000}
        />
        <button
          onClick={submit}
          disabled={sending || !text.trim()}
          className="text-white font-semibold rounded-[10px] px-4 text-sm"
          style={{ background: primary, opacity: sending || !text.trim() ? 0.5 : 1 }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
