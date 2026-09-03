'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Admin · Infolinks (freemium Sellea) — métricas + lista de usuarios "Solo
 * InfoLink" de la marca. Brand-scoped en el backend (GET /admin/marketing/infolinks).
 * Vive bajo /admin (hereda el guard del layout). Sección 2F del plan freemium.
 */
type IlUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  url: string;
  tier: 'FREE' | 'PRO';
  status: string;
  createdAt: string;
  visits: number;
};
type IlData = {
  metrics: { total: number; free: number; pro: number; active: number; suspended: number; totalVisits: number };
  users: IlUser[];
};

const FILTERS: Array<{ k: string; label: string }> = [
  { k: 'all', label: 'Todos' },
  { k: 'free', label: 'Gratis' },
  { k: 'pro', label: 'PRO' },
  { k: 'active', label: 'Activos' },
];

export default function AdminInfolinksPage() {
  const [data, setData] = useState<IlData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api<IlData>('/admin/marketing/infolinks')
      .then(setData)
      .catch((e) => setErr(e?.message || 'No se pudo cargar.'));
  }, []);

  const users = (data?.users ?? []).filter((u) => {
    if (filter === 'free') return u.tier === 'FREE';
    if (filter === 'pro') return u.tier === 'PRO';
    if (filter === 'active') return u.status === 'ACTIVE';
    return true;
  });

  const fmtDate = (s: string) => {
    try { return new Date(s).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch { return s; }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-brand font-bold">Infolinks</div>
      <h1 className="text-2xl font-bold text-ink">Usuarios de Infolink</h1>
      <p className="text-mute text-sm mt-1">Negocios "Solo InfoLink" (freemium) de tu marca — Gratis y PRO.</p>

      {err && (
        <div className="mt-4 rounded-lg bg-bad-soft text-bad px-4 py-3 text-sm">{err}</div>
      )}

      {!data && !err && <div className="mt-6 text-mute">Cargando…</div>}

      {data && (
        <>
          {/* Métricas */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
            <Tile label="Total" value={data.metrics.total} />
            <Tile label="Gratis" value={data.metrics.free} />
            <Tile label="PRO" value={data.metrics.pro} accent />
            <Tile label="Activos" value={data.metrics.active} />
            <Tile label="Visitas" value={data.metrics.totalVisits} />
          </div>

          {/* Tabla */}
          <div className="mt-6 rounded-2xl border border-line bg-surface overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line flex-wrap">
              {FILTERS.map((f) => (
                <button
                  key={f.k}
                  onClick={() => setFilter(f.k)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                    filter === f.k ? 'bg-ink text-white' : 'text-mute hover:text-ink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-mute">{users.length} usuario(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-mute">
                    <th className="px-4 py-2.5 font-bold">Usuario</th>
                    <th className="px-4 py-2.5 font-bold">URL</th>
                    <th className="px-4 py-2.5 font-bold">Plan</th>
                    <th className="px-4 py-2.5 font-bold">Visitas</th>
                    <th className="px-4 py-2.5 font-bold">Estado</th>
                    <th className="px-4 py-2.5 font-bold">Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-line2">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{u.name}</div>
                        <div className="text-xs text-mute">{u.email || '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`/i/${u.url}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-brand hover:underline"
                        >
                          /i/{u.url}
                        </a>
                      </td>
                      <td className="px-4 py-3">
                        {u.tier === 'PRO' ? (
                          <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-brand/15 text-brand">PRO</span>
                        ) : (
                          <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-ink/10 text-ink">GRATIS</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums">{u.visits.toLocaleString('es-CO')}</td>
                      <td className="px-4 py-3">
                        <span className={u.status === 'ACTIVE' ? 'text-ok' : 'text-mute'}>
                          {u.status === 'ACTIVE' ? '● Activo' : '○ ' + u.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-mute">{fmtDate(u.createdAt)}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-mute">
                        Aún no hay usuarios de Infolink en este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? 'border-brand/30 bg-brand/5' : 'border-line bg-surface'}`}>
      <div className="text-xs font-bold text-mute">{label}</div>
      <div className={`text-2xl font-extrabold mt-1 tabular-nums ${accent ? 'text-brand' : 'text-ink'}`}>
        {value.toLocaleString('es-CO')}
      </div>
    </div>
  );
}
