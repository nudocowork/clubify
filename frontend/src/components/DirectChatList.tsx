'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { DeliveryChat, type ChatMessage, type ChatRole } from './DeliveryChat';

export type ChatPeer = {
  id: string;
  name: string;
  lastMessage: string | null;
  lastAt: string | null;
};

/**
 * Lista de chats DIRECTOS por interlocutor (PDF 1254). Reutilizable por:
 *  - la empresa de domicilios (/domicilios): un chat por cada NEGOCIO que atiende.
 *  - el negocio (/app): un chat con cada EMPRESA de domicilios asignada.
 * Cada interlocutor abre una conversación continua (no atada a un pedido).
 */
export function DirectChatList({
  fetchPeers,
  chatPath,
  meRole,
  title,
  emptyText,
  primary = '#0ea5e9',
  hideWhenEmpty = false,
}: {
  fetchPeers: () => Promise<ChatPeer[]>;
  chatPath: (peerId: string) => string;
  meRole: ChatRole;
  title: string;
  emptyText: string;
  primary?: string;
  /** Si no hay interlocutores, no renderiza nada (para el lado negocio, que
   *  solo debe ver el widget si tiene una empresa de domicilios asignada). */
  hideWhenEmpty?: boolean;
}) {
  const [peers, setPeers] = useState<ChatPeer[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchPeers()
      .then((p) => setPeers(p ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [fetchPeers]);

  if (loaded && peers.length === 0 && hideWhenEmpty) return null;

  if (loaded && peers.length === 0) {
    return (
      <section className="mb-5">
        <h2
          className="text-[13px] font-bold uppercase mb-2"
          style={{ color: '#0369a1', letterSpacing: 0.5 }}
        >
          {title}
        </h2>
        <div
          className="rounded-[14px] p-5 text-center text-[13px]"
          style={{ background: 'white', border: '1px dashed #d8dce0', color: '#9aa4af' }}
        >
          {emptyText}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-5">
      <h2
        className="text-[13px] font-bold uppercase mb-2"
        style={{ color: '#0369a1', letterSpacing: 0.5 }}
      >
        {title} {peers.length > 0 && `(${peers.length})`}
      </h2>
      <div className="space-y-2">
        {peers.map((p) => {
          const open = openId === p.id;
          return (
            <div
              key={p.id}
              className="rounded-[14px] overflow-hidden"
              style={{ background: 'white', border: '1px solid #e5e7eb' }}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : p.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-[14px] text-gray-900 truncate">
                    {p.name}
                  </div>
                  <div className="text-[12px] text-gray-400 truncate">
                    {p.lastMessage ?? 'Sin mensajes aún'}
                  </div>
                </div>
                <span className="text-gray-400 text-sm flex-none">
                  {open ? '▲' : '💬'}
                </span>
              </button>
              {open && (
                <div className="px-2 pb-2">
                  <DeliveryChat
                    meRole={meRole}
                    primary={primary}
                    heightPx={300}
                    load={() => api<ChatMessage[]>(chatPath(p.id))}
                    send={(body) =>
                      api<ChatMessage[]>(chatPath(p.id), {
                        method: 'POST',
                        body: JSON.stringify({ body }),
                      })
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
