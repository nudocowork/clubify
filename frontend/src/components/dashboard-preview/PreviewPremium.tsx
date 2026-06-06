'use client';

/**
 * Preview 5 — PREMIUM (Stripe / Vercel / Linear inspired).
 * Hero ARR + 4 KPIs + 2 charts + mini map + actividad reciente.
 * Glassmorphism, gradients sutiles, tipografía Inter.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { KpiCard } from './KpiCard';
import { MiniLineChart } from './MiniLineChart';
import { EmptyState } from './EmptyState';
import {
  usePreviewData,
  usd,
  fmtDate,
  buildSimulatedMrrSeries,
} from './shared';

export function PreviewPremium() {
  const { global, dashboard, tenants, loading } = usePreviewData();

  // Crecimiento mes a mes — derivado de la serie simulada.
  const revenueSeries = useMemo(
    () => buildSimulatedMrrSeries(global?.mrrUsd ?? 0, 6),
    [global?.mrrUsd],
  );

  const growthPct = useMemo(() => {
    if (revenueSeries.length < 2) return 0;
    const last = revenueSeries[revenueSeries.length - 1].value;
    const prev = revenueSeries[revenueSeries.length - 2].value;
    if (prev === 0) return 100;
    return Math.round(((last - prev) / prev) * 100);
  }, [revenueSeries]);

  // ARPU = MRR / activeTenants (Average Revenue Per User).
  const arpu = useMemo(() => {
    if (!global || !global.activeTenants) return 0;
    return Math.round(global.mrrUsd / global.activeTenants);
  }, [global]);

  // Churn % = churnedLast30 / activeTenants (aproximación).
  const churnPct = useMemo(() => {
    if (!global || !global.activeTenants) return 0;
    return Math.round((global.churnedLast30 / global.activeTenants) * 100);
  }, [global]);

  // Comisiones stacked bar (6 meses simulado).
  // TODO: cuando exista endpoint /admin/metrics/commissions-by-month reemplazar.
  const commSeries = useMemo(() => {
    const paid = dashboard?.comisionesPagadasMesUsd ?? 0;
    const pending = dashboard?.comisionesPendientesUsd ?? 0;
    const months = revenueSeries.map((p, i) => {
      const factor = (i + 1) / revenueSeries.length;
      return {
        label: p.label,
        Pagadas: Math.round(paid * factor),
        Pendientes: Math.round(pending * factor * 0.4),
      };
    });
    return months;
  }, [revenueSeries, dashboard]);

  // Actividad reciente (proxy de tenants.createdAt).
  const actividad = useMemo(() => {
    if (!tenants) return [];
    return [...tenants]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 8);
  }, [tenants]);

  if (loading && !global) {
    return <EmptyState text="Cargando vista premium…" icon="chart" />;
  }

  return (
    <div className="relative">
      {/* Background sutil gradient */}
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 20% 0%, rgba(34,197,94,.08), transparent 50%), radial-gradient(circle at 80% 100%, rgba(99,102,241,.06), transparent 50%)',
        }}
      />

      <div className="mb-5">
        <h2 className="text-2xl font-bold text-ink">Vista premium</h2>
        <p className="text-sm text-mute mt-1">
          Métricas SaaS de alto nivel, diseñadas para escala.
        </p>
      </div>

      {/* Hero ARR card */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-900 text-white p-6 md:p-8 shadow-md2 mb-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-300 font-semibold">
              Annual Recurring Revenue
            </div>
            <div className="text-5xl md:text-6xl font-bold tracking-tight mt-2">
              {usd(global?.arrUsd ?? 0)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill font-semibold ${
                  growthPct >= 0
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-red-500/20 text-red-300'
                }`}
              >
                {growthPct >= 0 ? '▲' : '▼'} {Math.abs(growthPct)}%
              </span>
              <span className="text-slate-300">vs mes anterior</span>
            </div>
          </div>
          <div className="text-right hidden md:block">
            <div className="text-xs text-slate-300">MRR actual</div>
            <div className="text-3xl font-bold mt-1">
              {usd(global?.mrrUsd ?? 0)}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              {global?.activeTenants ?? 0} negocios activos
            </div>
          </div>
        </div>
      </div>

      {/* 4 KPIs glass */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          variant="glass"
          label="MRR"
          value={usd(global?.mrrUsd ?? 0)}
          sub="Recurrente mensual"
          tone="brand"
          trend={{
            dir: growthPct >= 0 ? 'up' : 'down',
            label: `${growthPct}%`,
          }}
          icon="💎"
        />
        <KpiCard
          variant="glass"
          label="Conversion rate"
          value={
            global?.conversionRate30 != null
              ? `${global.conversionRate30}%`
              : '—'
          }
          sub="Trial → Cliente"
          tone={
            global?.conversionRate30 == null
              ? 'neutral'
              : global.conversionRate30 >= 50
              ? 'ok'
              : 'warn'
          }
          icon="🎯"
        />
        <KpiCard
          variant="glass"
          label="ARPU"
          value={usd(arpu)}
          sub="Revenue por negocio"
          tone="info"
          icon="👥"
        />
        <KpiCard
          variant="glass"
          label="Churn"
          value={`${churnPct}%`}
          sub={`${global?.churnedLast30 ?? 0} bajas 30d`}
          tone={churnPct >= 10 ? 'bad' : churnPct >= 5 ? 'warn' : 'ok'}
          icon="📉"
        />
      </div>

      {/* 2 charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                Tendencia de revenue
              </div>
              <div className="text-base font-bold text-ink mt-0.5">
                Últimos 6 meses
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-mute">MRR</div>
              <div className="text-lg font-bold text-brand">
                {usd(global?.mrrUsd ?? 0)}
              </div>
            </div>
          </div>
          <MiniLineChart
            data={revenueSeries}
            height={200}
            color="#22C55E"
            area
            showAxes
            showGrid
            valueFormatter={(n) => usd(n)}
          />
        </div>

        <div className="rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                Comisiones
              </div>
              <div className="text-base font-bold text-ink mt-0.5">
                Pagadas vs pendientes
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={commSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                stroke="#9CA3AF"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                fontSize={11}
                stroke="#9CA3AF"
                tickFormatter={(v) => usd(Number(v))}
                width={50}
              />
              <Tooltip
                formatter={(v) => usd(Number(v))}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #E5E7EB',
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Pagadas" stackId="c" fill="#22C55E" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Pendientes" stackId="c" fill="#F59E0B" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom: mini map + actividad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Pipeline
          </div>
          <div className="text-base font-bold text-ink mt-0.5 mb-4">
            Estado de la red
          </div>
          <PipelineRing
            label="Activos"
            value={global?.activeTenants ?? 0}
            total={global?.tenants ?? 1}
            color="#22C55E"
          />
          <PipelineRing
            label="Trials"
            value={global?.trialTenants ?? 0}
            total={global?.tenants ?? 1}
            color="#F59E0B"
          />
          <PipelineRing
            label="Suspendidos"
            value={global?.suspendedTenants ?? 0}
            total={global?.tenants ?? 1}
            color="#EF4444"
          />
          <Link
            href="/admin/map"
            className="block mt-3 text-xs font-semibold text-brand hover:underline text-center"
          >
            Ver mapa ejecutivo →
          </Link>
        </div>

        <div className="lg:col-span-2 rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Actividad reciente
          </div>
          <div className="text-base font-bold text-ink mt-0.5 mb-3">
            Últimos signups
          </div>
          {actividad.length === 0 ? (
            <EmptyState text="Sin actividad reciente." />
          ) : (
            <ul className="divide-y divide-line2">
              {actividad.map((t) => (
                <li
                  key={t.id}
                  className="py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                        t.status === 'ACTIVE'
                          ? 'bg-ok'
                          : t.status === 'TRIAL'
                          ? 'bg-warn'
                          : t.status === 'SUSPENDED'
                          ? 'bg-bad'
                          : 'bg-mute'
                      }`}
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="font-medium text-ink hover:text-brand truncate block"
                      >
                        {t.brandName}
                      </Link>
                      <div className="text-xs text-mute truncate">
                        {t.email ?? 'sin email'} · {fmtDate(t.createdAt)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`badge ${
                      t.status === 'ACTIVE'
                        ? 'badge-ok'
                        : t.status === 'TRIAL'
                        ? 'badge-warn'
                        : t.status === 'SUSPENDED'
                        ? 'badge-bad'
                        : 'badge-mute'
                    }`}
                  >
                    {t.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PipelineRing({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = Math.round((value / Math.max(1, total)) * 100);
  return (
    <div className="flex items-center gap-3 mb-3 last:mb-0">
      <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0">
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke="#EEF0F3"
          strokeWidth="4"
        />
        <circle
          cx="20"
          cy="20"
          r="16"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeDasharray={`${(pct / 100) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
          strokeDashoffset={`${(2 * Math.PI * 16) / 4}`}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-mute">{label}</div>
        <div className="text-lg font-bold text-ink">{value}</div>
      </div>
      <div className="text-xs font-semibold" style={{ color }}>
        {pct}%
      </div>
    </div>
  );
}
