'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Trial = {
  id: string;
  brandName: string;
  email: string;
  phone: string | null;
  company: string | null;
  city: string | null;
  source: string | null;
  status: 'TRIAL_ACTIVE' | 'TRIAL_EXPIRED' | 'CONVERTED' | 'SUSPENDED';
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  daysLeft: number | null;
  createdAt: string;
  referrer: {
    code: string;
    name: string;
    role: 'INFLUENCER' | 'AMBASSADOR';
  } | null;
};

type Metrics = {
  counts: {
    total: number;
    active: number;
    expired: number;
    converted: number;
    suspended: number;
  };
  conversionPct: number | null;
  bySource: Record<
    string,
    {
      total: number;
      active: number;
      converted: number;
      expired: number;
      conversionPct: number | null;
    }
  >;
  byReferrer: Array<{
    code: string;
    name: string;
    role: string;
    total: number;
    converted: number;
    conversionPct: number | null;
  }>;
};

type Filter = 'all' | 'active' | 'expired' | 'converted';

const STATUS_BADGE: Record<Trial['status'], { label: string; cls: string }> = {
  TRIAL_ACTIVE: { label: 'Activo', cls: 'badge-ok' },
  TRIAL_EXPIRED: { label: 'Vencido', cls: 'badge-warn' },
  CONVERTED: { label: 'Cliente', cls: 'badge-ok' },
  SUSPENDED: { label: 'Suspendido', cls: 'badge-bad' },
};

const SOURCE_LABEL: Record<string, string> = {
  LANDING: 'Landing',
  AMBASSADOR: 'Embajador',
  INFLUENCER: 'Influencer',
  CAMPAIGN: 'Campaña',
  DIRECT: 'Directo',
};

export default function TrialsAdminPage() {
  const [trials, setTrials] = useState<Trial[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  async function load() {
    try {
      const [t, m] = await Promise.all([
        api<Trial[]>(`/admin/trials?filter=${filter}`),
        api<Metrics>('/admin/trials/metrics'),
      ]);
      setTrials(t);
      setMetrics(m);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando trials', 'error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="max-w-6xl">
      <div className="page-head">
        <h1 className="page-title">
          Trials <span className="page-crumb">/ Modo prueba</span>
        </h1>
      </div>

      {/* KPI cards */}
      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <KpiCard label="Trials activos" value={metrics.counts.active} accent="ok" />
          <KpiCard label="Vencidos" value={metrics.counts.expired} accent="warn" />
          <KpiCard label="Convertidos" value={metrics.counts.converted} accent="ok" />
          <KpiCard label="Suspendidos" value={metrics.counts.suspended} accent="bad" />
          <KpiCard
            label="% Conversión"
            value={metrics.conversionPct !== null ? `${metrics.conversionPct}%` : '—'}
            accent="brand"
            hint="convertidos / (convertidos + vencidos)"
          />
        </div>
      )}

      {/* Breakdown por source */}
      {metrics && Object.keys(metrics.bySource).length > 0 && (
        <div className="card card-pad mb-5">
          <h2 className="text-base font-semibold m-0">Por canal de origen</h2>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(metrics.bySource).map(([src, s]) => (
              <div key={src} className="rounded-lg border border-line2 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                  {SOURCE_LABEL[src] ?? src}
                </div>
                <div className="text-xl font-bold mt-1">{s.total}</div>
                <div className="text-[11px] text-mute mt-1">
                  {s.active} activos · {s.converted} pagaron
                </div>
                {s.conversionPct !== null && (
                  <div className="text-[11px] text-brand font-semibold mt-0.5">
                    {s.conversionPct}% conv.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breakdown por embajador */}
      {metrics && metrics.byReferrer.length > 0 && (
        <div className="card card-pad mb-5">
          <h2 className="text-base font-semibold m-0">Top embajadores / influencers</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mute text-[11px] uppercase tracking-wider border-b border-line2">
                  <th className="py-2 font-semibold">Código</th>
                  <th className="py-2 font-semibold">Nombre</th>
                  <th className="py-2 font-semibold">Rol</th>
                  <th className="py-2 font-semibold text-right">Trials</th>
                  <th className="py-2 font-semibold text-right">Convertidos</th>
                  <th className="py-2 font-semibold text-right">% conv.</th>
                </tr>
              </thead>
              <tbody>
                {metrics.byReferrer.map((r) => (
                  <tr key={r.code} className="border-b border-line2/40">
                    <td className="py-2 font-mono text-xs">{r.code}</td>
                    <td className="py-2 font-medium">{r.name}</td>
                    <td className="py-2 text-mute text-xs">{r.role}</td>
                    <td className="py-2 text-right">{r.total}</td>
                    <td className="py-2 text-right">{r.converted}</td>
                    <td className="py-2 text-right font-semibold text-brand">
                      {r.conversionPct !== null ? `${r.conversionPct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4">
        {(['all', 'active', 'expired', 'converted'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-sm px-3.5 py-1.5 rounded-pill transition ${
              filter === f
                ? 'bg-brand text-white font-semibold'
                : 'bg-bg2 text-ink hover:bg-bg3'
            }`}
          >
            {f === 'all'
              ? 'Todos'
              : f === 'active'
              ? 'Activos'
              : f === 'expired'
              ? 'Vencidos'
              : 'Convertidos'}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="card overflow-hidden">
        {!trials ? (
          <div className="p-6 text-mute text-sm">Cargando…</div>
        ) : trials.length === 0 ? (
          <div className="p-10 text-center text-mute">
            <div className="text-4xl mb-2">📭</div>
            Sin trials en este filtro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 font-semibold">Negocio</th>
                  <th className="px-4 py-3 font-semibold">Contacto</th>
                  <th className="px-4 py-3 font-semibold">Origen</th>
                  <th className="px-4 py-3 font-semibold">Inicio</th>
                  <th className="px-4 py-3 font-semibold">Fin</th>
                  <th className="px-4 py-3 font-semibold text-right">Días</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t) => {
                  const badge = STATUS_BADGE[t.status];
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-line2 hover:bg-bg2/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{t.brandName}</div>
                        {t.city && (
                          <div className="text-[11px] text-mute">{t.city}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="truncate max-w-[200px]">{t.email}</div>
                        {t.phone && (
                          <div className="text-mute">{t.phone}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div>{SOURCE_LABEL[t.source ?? 'DIRECT'] ?? t.source}</div>
                        {t.referrer && (
                          <div className="text-mute mt-0.5">
                            via {t.referrer.name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {t.trialStartedAt
                          ? new Date(t.trialStartedAt).toLocaleDateString(
                              'es-CO',
                              { day: 'numeric', month: 'short' },
                            )
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {t.trialEndsAt
                          ? new Date(t.trialEndsAt).toLocaleDateString(
                              'es-CO',
                              { day: 'numeric', month: 'short' },
                            )
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {t.daysLeft !== null ? (
                          t.status === 'TRIAL_ACTIVE' ? (
                            <span className="text-brand">{t.daysLeft}</span>
                          ) : (
                            <span className="text-mute">{t.daysLeft}</span>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/tenants/${t.id}`}
                          className="text-brand text-xs hover:underline"
                        >
                          Ver →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px] text-mute mt-3">
        Acciones (extender, convertir, suspender) en el detalle del negocio.
        Los recordatorios SMS internos a Javier + Jhon se disparan
        automáticamente a 5/3/1 días y 12h antes del vencimiento.
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number | string;
  accent: 'ok' | 'warn' | 'bad' | 'brand';
  hint?: string;
}) {
  const color =
    accent === 'ok'
      ? 'text-ok'
      : accent === 'warn'
      ? 'text-amber-600'
      : accent === 'bad'
      ? 'text-bad'
      : 'text-brand';
  return (
    <div className="card card-pad">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {hint && <div className="text-[10px] text-mute mt-1">{hint}</div>}
    </div>
  );
}
