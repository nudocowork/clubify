'use client';
import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';

type AuditEntry = {
  id: string;
  actorId: string | null;
  actor: { id: string; email: string; fullName: string | null } | null;
  tenantId: string | null;
  action: string;
  resource: string;
  metadata: any;
  createdAt: string;
};

const ACTION_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  'superadmin.white_label.create': { label: 'Marca creada', icon: '✨', color: '#15803d', bg: '#dcfce7' },
  'superadmin.white_label.update': { label: 'Marca editada', icon: '✏️', color: '#1e40af', bg: '#dbeafe' },
  'superadmin.white_label.status': { label: 'Estado cambiado', icon: '🔄', color: '#b45309', bg: '#fef3c7' },
  'superadmin.impersonate_white_label': { label: 'Entrada como marca', icon: '🏛', color: '#6d28d9', bg: '#ede9fe' },
  'superadmin.credits.adjust': { label: 'Ajuste de créditos', icon: '💳', color: '#0e7490', bg: '#cffafe' },
  'superadmin.module.toggle': { label: 'Módulo toggleado', icon: '⊞', color: '#c2410c', bg: '#ffedd5' },
};

function fmtRelative(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `hace ${days}d`;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function HistorialPage() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [filter, setFilter] = useState<string>('todas');

  useEffect(() => {
    api<AuditEntry[]>('/superadmin/history')
      .then(setItems)
      .catch((e) => console.error(e));
  }, []);

  const grouped = useMemo(() => {
    if (!items) return [] as Array<{ date: string; entries: AuditEntry[] }>;
    const list = items.filter((i) => filter === 'todas' || i.action === filter);
    const m = new Map<string, AuditEntry[]>();
    for (const it of list) {
      const day = new Date(it.createdAt).toLocaleDateString('es-MX', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const arr = m.get(day) ?? [];
      arr.push(it);
      m.set(day, arr);
    }
    return Array.from(m.entries()).map(([date, entries]) => ({ date, entries }));
  }, [items, filter]);

  const uniqueActions = useMemo(() => {
    if (!items) return [] as string[];
    return Array.from(new Set(items.map((i) => i.action)));
  }, [items]);

  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Historial
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Bitácora de eventos del Master Admin · {items?.length ?? 0} acciones registradas.
      </p>

      <div className="flex gap-1.5 flex-wrap mb-4">
        <FilterChip label="Todas" active={filter === 'todas'} onClick={() => setFilter('todas')} />
        {uniqueActions.map((a) => {
          const meta = ACTION_META[a] ?? { label: a, icon: '·', color: '#6b7785', bg: '#f3f4f6' };
          return (
            <FilterChip
              key={a}
              label={`${meta.icon} ${meta.label}`}
              active={filter === a}
              onClick={() => setFilter(a)}
            />
          );
        })}
      </div>

      {!items ? (
        <div className="text-sm" style={{ color: '#9aa4af' }}>Cargando…</div>
      ) : grouped.length === 0 ? (
        <div
          className="rounded-[14px] p-10 text-center"
          style={{ background: 'white', border: '1px solid #e7e9ec' }}
        >
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3"
            style={{ background: '#f0fdf4', color: '#15803d' }}
          >
            🕒
          </div>
          <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
            Sin eventos con este filtro
          </h2>
          <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: '#6b7785' }}>
            Las acciones que hagas desde el Master Admin van a aparecer acá automáticamente.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((g) => (
            <div key={g.date}>
              <div
                className="text-[11px] font-bold uppercase mb-2"
                style={{ letterSpacing: 0.8, color: '#9aa4af' }}
              >
                {g.date}
              </div>
              <div
                className="rounded-[14px] overflow-hidden"
                style={{ background: 'white', border: '1px solid #e7e9ec' }}
              >
                {g.entries.map((e, i) => (
                  <EntryRow key={e.id} entry={e} isLast={i === g.entries.length - 1} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntryRow({ entry, isLast }: { entry: AuditEntry; isLast: boolean }) {
  const meta = ACTION_META[entry.action] ?? {
    label: entry.action,
    icon: '·',
    color: '#6b7785',
    bg: '#f3f4f6',
  };
  const subtitle = describeMetadata(entry.action, entry.metadata);
  return (
    <div
      className="flex items-start gap-3 px-5 py-3.5"
      style={{ borderBottom: isLast ? 'none' : '1px solid #eef0f2' }}
    >
      <div
        className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base shrink-0"
        style={{ background: meta.bg, color: meta.color }}
      >
        {meta.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm" style={{ color: '#16241c' }}>
          <span className="font-semibold">{meta.label}</span>
          {subtitle && (
            <span className="opacity-70" style={{ color: '#6b7785' }}>
              {' · '}
              {subtitle}
            </span>
          )}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#9aa4af' }}>
          {entry.actor?.email ?? entry.actorId ?? 'sistema'}
        </div>
      </div>
      <div className="text-xs shrink-0" style={{ color: '#9aa4af' }}>
        {fmtRelative(entry.createdAt)}
      </div>
    </div>
  );
}

function describeMetadata(action: string, m: any): string {
  if (!m) return '';
  switch (action) {
    case 'superadmin.white_label.create':
      return m.whiteLabelName ? `«${m.whiteLabelName}»` : '';
    case 'superadmin.white_label.update':
      return m.whiteLabelName ? `«${m.whiteLabelName}»` : '';
    case 'superadmin.white_label.status':
      return `«${m.whiteLabelName ?? '?'}» ${m.from} → ${m.to}`;
    case 'superadmin.impersonate_white_label':
      return `«${m.whiteLabelName ?? '?'}»`;
    case 'superadmin.credits.adjust':
      const amt = m.amount > 0 ? `+${m.amount}` : `${m.amount}`;
      return `«${m.whiteLabelName ?? '?'}» ${amt} créditos${m.note ? ` · ${m.note}` : ''}`;
    case 'superadmin.module.toggle':
      return `«${m.whiteLabelName ?? '?'}» ${m.module} ${m.enabled ? 'ON' : 'OFF'}`;
    default:
      return '';
  }
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-semibold transition"
      style={{
        padding: '7px 12px',
        borderRadius: 9,
        background: active ? '#16241c' : 'white',
        color: active ? 'white' : '#2b3a30',
        border: '1px solid #d7dbe0',
      }}
    >
      {label}
    </button>
  );
}
