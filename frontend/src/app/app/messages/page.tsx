'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Message = {
  id: string;
  channel: string;
  direction: 'OUT' | 'IN';
  body: string;
  status: string;
  createdAt: string;
  customer: { fullName: string; phone: string } | null;
};

const STATUS_BADGE: Record<string, string> = {
  QUEUED: 'badge-mute',
  SENT: 'badge-info',
  DELIVERED: 'badge-ok',
  READ: 'badge-ok',
  FAILED: 'badge-bad',
};

export default function MessagesPage() {
  const [list, setList] = useState<Message[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'WHATSAPP' | 'SMS' | 'PUSH'>(
    'ALL',
  );

  async function load() {
    setList(await api('/messages'));
  }
  useEffect(() => {
    load();
  }, []);

  const visible = list.filter((m) =>
    filter === 'ALL' ? true : m.channel.includes(filter),
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Mensajes <span className="page-crumb">/ {list.length} totales</span>
        </h1>
      </div>

      <div className="mb-3.5">
        <div className="tabs">
          {(['ALL', 'WHATSAPP', 'SMS', 'PUSH'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`tab ${filter === f ? 'tab-active' : ''}`}
            >
              {f === 'ALL' ? 'Todos' : f}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {visible.length === 0 && (
          <div className="card card-pad text-mute text-sm">
            Sin mensajes aún. Las automatizaciones generan mensajes que aparecen acá.
          </div>
        )}
        {visible.map((m) => (
          <div key={m.id} className="card card-pad">
            <div className="flex items-center justify-between text-xs text-mute mb-1.5">
              <div className="flex items-center gap-2">
                <span className="badge badge-info">{m.channel}</span>
                <span className={`badge ${STATUS_BADGE[m.status] ?? 'badge-mute'}`}>
                  {m.status}
                </span>
                {m.customer && (
                  <span>
                    → {m.customer.fullName} ({m.customer.phone})
                  </span>
                )}
              </div>
              <span>{new Date(m.createdAt).toLocaleString('es-CO')}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{m.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
