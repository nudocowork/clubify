'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Audit = {
  id: string;
  actorId: string | null;
  actor: { id: string; fullName: string; email: string } | null;
  tenantId: string | null;
  action: string;
  resource: string;
  metadata: any;
  ip: string | null;
  createdAt: string;
};

function fmtTime(s: string) {
  return new Date(s).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function actionTone(action: string) {
  if (action.includes('failed') || action.includes('delete')) return 'bg-bad-soft text-bad-ink';
  if (action.includes('login')) return 'bg-info-soft text-info-ink';
  if (action.includes('create') || action.includes('invite')) return 'bg-ok-soft text-ok-ink';
  if (action.includes('payment')) return 'bg-warn-soft text-warn-ink';
  return 'bg-gray-100 text-gray-700';
}

export default function AuditLogsPage() {
  const [items, setItems] = useState<Audit[]>([]);
  const [filters, setFilters] = useState({
    action: '',
    resource: '',
    tenantId: '',
  });
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.action) params.set('action', filters.action);
      if (filters.resource) params.set('resource', filters.resource);
      if (filters.tenantId) params.set('tenantId', filters.tenantId);
      params.set('take', '200');
      const data = await api<Audit[]>(`/audit?${params}`);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Audit log{' '}
          <span className="page-crumb">/ {items.length} eventos recientes</span>
        </h1>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          <Icon name="history" /> {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      <div className="card card-pad mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input
            className="input"
            placeholder="Acción (login, payment...)"
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <input
            className="input"
            placeholder="Recurso (user, order...)"
            value={filters.resource}
            onChange={(e) =>
              setFilters({ ...filters, resource: e.target.value })
            }
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <input
            className="input"
            placeholder="tenantId"
            value={filters.tenantId}
            onChange={(e) =>
              setFilters({ ...filters, tenantId: e.target.value })
            }
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <button className="btn-primary" onClick={load}>
            <Icon name="search" /> Buscar
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {items.length === 0 ? (
          <div className="text-center text-mute p-8 text-sm">
            Sin eventos para los filtros aplicados
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg2">
                <tr>
                  {['Cuándo', 'Acción', 'Recurso', 'Actor', 'IP', 'Metadata'].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-line2 hover:bg-bg2/50 align-top"
                  >
                    <td className="px-4 py-2.5 text-xs text-mute whitespace-nowrap">
                      {fmtTime(a.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`badge ${actionTone(a.action)} text-[10px]`}
                      >
                        {a.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <code className="bg-bg2 px-1.5 py-0.5 rounded">
                        {a.resource}
                      </code>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {a.actor ? (
                        <div>
                          <div>{a.actor.fullName}</div>
                          <div className="text-mute">{a.actor.email}</div>
                        </div>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-mute font-mono">
                      {a.ip ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-mute max-w-xs">
                      {a.metadata && Object.keys(a.metadata).length > 0 ? (
                        <code className="text-[11px]">
                          {JSON.stringify(a.metadata)}
                        </code>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
