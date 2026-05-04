'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

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
    try {
      setList(await api('/messages'));
    } catch (e: any) {
      toast(e.message || 'Error cargando mensajes', 'error');
    }
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
          <div className="card card-pad text-center py-10">
            <div className="text-3xl mb-1">💬</div>
            <div className="font-semibold text-sm">
              {filter === 'ALL'
                ? 'Sin mensajes todavía'
                : `Sin mensajes de ${filter}`}
            </div>
            <p className="text-xs text-mute mt-1 max-w-md mx-auto">
              Las automatizaciones de WhatsApp y los mensajes manuales que
              envíes a clientes aparecerán aquí. Cada uno trae estado de
              entrega y enlace al cliente.
            </p>
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
