'use client';

/**
 * Dashboard admin oficial v2 — Fase G (2026-06-07).
 *
 * Banner azul con rango de fechas + facturado + facturación por plan +
 * clientes nuevos del mes con variación. Debajo: 4 KPIs (MRR,
 * Conversión, Tasa de cancelación, Comisiones pendientes), 2 charts
 * (Tendencia de recurrencia + Comisiones pagadas vs pendientes), bloque
 * Estado de clientes con mini mapa y Últimos ingresos.
 *
 * Endpoint: /admin/dashboard/metrics-v2?range=X[&from=&to=]
 */

import { useEffect, useMemo, useState } from 'react';
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
import { api } from '@/lib/api';
import { MiniLineChart } from './MiniLineChart';
import { EmptyState } from './EmptyState';
import { usd, fmtDate, buildSimulatedMrrSeries } from './shared';

type RangeKind =
  | 'today'
  | 'this-week'
  | 'this-month'
  | 'last-30'
  | 'this-quarter'
  | 'this-year';

const RANGE_OPTIONS: { value: RangeKind; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'this-week', label: 'Esta semana' },
  { value: 'this-month', label: 'Este mes' },
  { value: 'last-30', label: 'Últimos 30 días' },
  { value: 'this-quarter', label: 'Este trimestre' },
  { value: 'this-year', label: 'Este año' },
];

type DashboardResp = {
  range: { kind: string; from: string; to: string };
  banner: {
    billedUsd: number;
    billedByPlan: Array<{
      periodicity: string;
      label: string;
      count: number;
      billingUsd: number;
    }>;
    newCustomers: {
      currentMonth: number;
      lastMonth: number;
      deltaPct: number | null;
    };
  };
  kpis: {
    mrrUsd: number;
    conversionRate: number | null;
    cancellationRate: number;
    pendingCommissionsUsd: number;
  };
  clientStatus: {
    active: number;
    trial: number;
    awaitingPayment: number;
    suspended: number;
    cancelled: number;
  };
  recentIncome: Array<{
    kind: 'new_tenant' | 'trial_started' | 'trial_converted' | 'commission';
    label: string;
    tenantId?: string;
    tenantName?: string;
    when: string;
    amountUsd?: number;
    meta?: string;
  }>;
  mapPoints: Array<{
    id: string;
    tenantId: string;
    brandName: string;
    status: string;
    planPeriodicity: string | null;
    latitude: number;
    longitude: number;
    locationName: string;
    address: string;
  }>;
  generatedAt: string;
};

export function PremiumDashboard() {
  const [range, setRange] = useState<RangeKind>('this-month');
  const [data, setData] = useState<DashboardResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<DashboardResp>(`/admin/dashboard/metrics-v2?range=${range}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Serie de tendencia de recurrencia (6 meses simulado hasta que
  // exista endpoint histórico /admin/metrics/mrr-monthly).
  const mrrSeries = useMemo(
    () => buildSimulatedMrrSeries(data?.kpis.mrrUsd ?? 0, 6),
    [data?.kpis.mrrUsd],
  );

  // Comisiones stacked bar (6 meses simulado).
  const commSeries = useMemo(() => {
    const pending = data?.kpis.pendingCommissionsUsd ?? 0;
    return mrrSeries.map((p, i) => {
      const factor = (i + 1) / mrrSeries.length;
      return {
        label: p.label,
        Pagadas: Math.round(p.value * 0.15 * factor),
        Pendientes: Math.round(pending * factor * 0.4),
      };
    });
  }, [mrrSeries, data]);

  if (loading && !data) {
    return <EmptyState text="Cargando dashboard…" icon="chart" />;
  }
  if (!data) {
    return <EmptyState text="No se pudo cargar el dashboard." />;
  }

  return (
    <div className="relative">
      {/* Background sutil gradient */}
      <div
        className="absolute inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 20% 0%, rgba(59,130,246,.06), transparent 50%), radial-gradient(circle at 80% 100%, rgba(99,102,241,.06), transparent 50%)',
        }}
      />

      {/* Banner principal azul */}
      <div className="rounded-2xl bg-gradient-to-br from-sky-700 via-sky-700 to-indigo-700 text-white p-5 md:p-7 shadow-md2 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-sky-200 font-semibold">
              Monto facturado
            </div>
            <div className="text-4xl md:text-5xl font-bold tracking-tight mt-1">
              {usd(data.banner.billedUsd)}
            </div>
            <div className="text-xs text-sky-200 mt-1">
              Rango: {RANGE_OPTIONS.find((r) => r.value === range)?.label}
            </div>
          </div>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKind)}
            className="bg-white/10 border border-white/30 text-white rounded-pill px-4 py-2 text-sm font-semibold focus:outline-none focus:bg-white/20 transition"
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value} className="text-ink">
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* Facturación por plan */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          {data.banner.billedByPlan.map((p) => (
            <div
              key={p.periodicity}
              className="bg-white/10 backdrop-blur border border-white/20 rounded-lg px-3 py-2"
            >
              <div className="text-[10px] uppercase tracking-wider text-sky-200">
                {p.label}
              </div>
              <div className="font-bold text-base mt-0.5">
                {usd(p.billingUsd)}
              </div>
              <div className="text-[10px] text-sky-200">
                {p.count} negocios
              </div>
            </div>
          ))}
        </div>

        {/* Clientes nuevos del mes con variación */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm">
            <span className="text-sky-200">Clientes nuevos del mes:</span>{' '}
            <span className="font-bold text-base">
              {data.banner.newCustomers.currentMonth}
            </span>
          </div>
          {data.banner.newCustomers.deltaPct !== null && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs font-semibold ${
                data.banner.newCustomers.deltaPct >= 0
                  ? 'bg-emerald-500/20 text-emerald-100'
                  : 'bg-red-500/20 text-red-100'
              }`}
            >
              {data.banner.newCustomers.deltaPct >= 0 ? '▲' : '▼'}{' '}
              {Math.abs(data.banner.newCustomers.deltaPct)}%
            </span>
          )}
          <span className="text-xs text-sky-200">
            (vs {data.banner.newCustomers.lastMonth} mes anterior)
          </span>
        </div>
      </div>

      {/* 4 KPIs glass */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi
          label="Ingreso recurrente"
          value={usd(data.kpis.mrrUsd)}
          sub="MRR mensual"
          accent="brand"
          icon="💎"
        />
        <Kpi
          label="Conversión"
          value={
            data.kpis.conversionRate != null
              ? `${data.kpis.conversionRate}%`
              : '—'
          }
          sub="Trial → Cliente"
          accent={
            data.kpis.conversionRate == null
              ? 'neutral'
              : data.kpis.conversionRate >= 50
              ? 'ok'
              : 'warn'
          }
          icon="🎯"
        />
        <Kpi
          label="Tasa de cancelación"
          value={`${data.kpis.cancellationRate}%`}
          sub="Clientes que cancelaron"
          accent={
            data.kpis.cancellationRate >= 10
              ? 'bad'
              : data.kpis.cancellationRate >= 5
              ? 'warn'
              : 'ok'
          }
          icon="📉"
        />
        <Kpi
          label="Comisiones pendientes"
          value={usd(data.kpis.pendingCommissionsUsd)}
          sub="Por pagar a afiliados"
          accent="amber"
          icon="💰"
        />
      </div>

      {/* 2 charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <div className="rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                Tendencia de recurrencia
              </div>
              <div className="text-base font-bold text-ink mt-0.5">
                Últimos 6 meses
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-mute">MRR</div>
              <div className="text-lg font-bold text-brand">
                {usd(data.kpis.mrrUsd)}
              </div>
            </div>
          </div>
          <MiniLineChart
            data={mrrSeries}
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
              <Bar dataKey="Pagadas" stackId="c" fill="#22C55E" />
              <Bar
                dataKey="Pendientes"
                stackId="c"
                fill="#F59E0B"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Estado de clientes + Mini mapa */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
        <div className="lg:col-span-1 rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Estado de clientes
          </div>
          <div className="text-base font-bold text-ink mt-0.5 mb-3">
            Distribución actual
          </div>
          <StatusRow
            label="Activos"
            value={data.clientStatus.active}
            color="#22C55E"
            total={totalClients(data)}
          />
          <StatusRow
            label="En trial"
            value={data.clientStatus.trial}
            color="#F59E0B"
            total={totalClients(data)}
          />
          <StatusRow
            label="Sin pago confirmado"
            value={data.clientStatus.awaitingPayment}
            color="#F97316"
            total={totalClients(data)}
          />
          <StatusRow
            label="Suspendidos"
            value={data.clientStatus.suspended}
            color="#EF4444"
            total={totalClients(data)}
          />
          <StatusRow
            label="Cancelados"
            value={data.clientStatus.cancelled}
            color="#71717A"
            total={totalClients(data)}
          />
        </div>

        <div className="lg:col-span-2 rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
          <div className="mb-3">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              Mapa
            </div>
            <div className="text-base font-bold text-ink mt-0.5">
              Ubicaciones activas ({data.mapPoints.length})
            </div>
          </div>
          <MiniMap points={data.mapPoints} />
        </div>
      </div>

      {/* Últimos ingresos */}
      <div className="rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-5">
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
          Últimos ingresos
        </div>
        <div className="text-base font-bold text-ink mt-0.5 mb-3">
          Actividad reciente que genera revenue
        </div>
        {data.recentIncome.length === 0 ? (
          <EmptyState text="Sin actividad reciente." />
        ) : (
          <ul className="divide-y divide-line2">
            {data.recentIncome.map((e, i) => (
              <li
                key={i}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <IncomeKindBadge kind={e.kind} />
                  <div className="min-w-0">
                    {e.tenantId ? (
                      <Link
                        href={`/admin/tenants/${e.tenantId}`}
                        className="font-medium text-ink hover:text-brand truncate block"
                      >
                        {e.tenantName ?? '—'}
                      </Link>
                    ) : (
                      <div className="font-medium text-ink truncate">
                        {e.tenantName ?? '—'}
                      </div>
                    )}
                    <div className="text-xs text-mute truncate">
                      {e.label}
                      {e.meta ? ` · ${e.meta}` : ''} · {fmtDate(e.when)}
                    </div>
                  </div>
                </div>
                {typeof e.amountUsd === 'number' && (
                  <div className="text-right font-bold text-sm text-brand">
                    {usd(e.amountUsd)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function totalClients(data: DashboardResp) {
  const s = data.clientStatus;
  return Math.max(
    1,
    s.active + s.trial + s.awaitingPayment + s.suspended + s.cancelled,
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  accent: 'brand' | 'ok' | 'warn' | 'bad' | 'amber' | 'neutral';
  icon: string;
}) {
  const cls: Record<typeof accent, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
    warn: 'text-amber-600',
    bad: 'text-red-600',
    amber: 'text-amber-700',
    neutral: 'text-mute',
  } as any;
  return (
    <div className="rounded-2xl backdrop-blur bg-white/80 border border-white/60 shadow-md2 p-4">
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          {label}
        </div>
        <span className="text-lg">{icon}</span>
      </div>
      <div className={`text-2xl font-bold mt-1 ${cls[accent]}`}>{value}</div>
      <div className="text-[11px] text-mute mt-0.5">{sub}</div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  color,
  total,
}: {
  label: string;
  value: number;
  color: string;
  total: number;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: color }}
          />
          <span>{label}</span>
        </span>
        <span className="font-bold">{value}</span>
      </div>
      <div className="h-1.5 bg-bg2 rounded overflow-hidden">
        <div
          className="h-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function IncomeKindBadge({
  kind,
}: {
  kind: 'new_tenant' | 'trial_started' | 'trial_converted' | 'commission';
}) {
  const config: Record<typeof kind, { emoji: string; bg: string }> = {
    new_tenant: { emoji: '🏢', bg: 'bg-blue-100' },
    trial_started: { emoji: '🎁', bg: 'bg-amber-100' },
    trial_converted: { emoji: '⭐', bg: 'bg-emerald-100' },
    commission: { emoji: '💵', bg: 'bg-violet-100' },
  } as any;
  const c = config[kind];
  return (
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 ${c.bg}`}
    >
      {c.emoji}
    </div>
  );
}

/**
 * Mini mapa SVG simple: proyección lineal de lat/lng a un viewBox.
 * Para el dashboard inline. Si querés mapa interactivo con zoom/pan
 * usá `/admin/business-map` (cuando esté implementado).
 */
function MiniMap({
  points,
}: {
  points: DashboardResp['mapPoints'];
}) {
  if (points.length === 0) {
    return (
      <div className="h-[200px] flex items-center justify-center text-mute text-xs">
        Sin ubicaciones registradas.
      </div>
    );
  }
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const padLat = Math.max(1, (maxLat - minLat) * 0.1);
  const padLng = Math.max(1, (maxLng - minLng) * 0.1);
  const w = 600;
  const h = 200;
  const project = (lat: number, lng: number) => {
    const x =
      ((lng - (minLng - padLng)) / (maxLng + padLng - (minLng - padLng))) * w;
    const y =
      h -
      ((lat - (minLat - padLat)) / (maxLat + padLat - (minLat - padLat))) * h;
    return [x, y];
  };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full rounded-lg bg-slate-50 border border-slate-100"
      style={{ height: 200 }}
    >
      {/* Grilla sutil */}
      <defs>
        <pattern
          id="grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 40 0 L 0 0 0 40"
            fill="none"
            stroke="#E5E7EB"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#grid)" />
      {points.map((p) => {
        const [x, y] = project(p.latitude, p.longitude);
        const color =
          p.status === 'ACTIVE'
            ? '#22C55E'
            : p.status === 'TRIAL'
            ? '#F59E0B'
            : '#EF4444';
        return (
          <g key={p.id}>
            <circle cx={x} cy={y} r="6" fill={color} opacity="0.25" />
            <circle cx={x} cy={y} r="3" fill={color}>
              <title>
                {p.brandName} — {p.locationName}
              </title>
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
