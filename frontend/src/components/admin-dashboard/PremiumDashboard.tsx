'use client';

/**
 * Dashboard admin oficial v2 — Fase G (2026-06-07).
 *
 * Banner azul con rango de fechas + facturado (real) + facturación por
 * plan + clientes nuevos del mes con variación. Toggle 👁 para ocultar
 * montos (#17). Debajo: 3 KPIs (MRR, Tasa de cancelación, Comisiones
 * pendientes), 2 charts con datos REALES de 6 meses (Tendencia de
 * recurrencia + Comisiones pagadas vs pendientes), bloque Estado de
 * clientes con mini mapa y Últimos ingresos.
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
import { usd, fmtDate } from './shared';

type RangeKind =
  | 'today'
  | 'this-week'
  | 'last-30'
  | 'this-quarter'
  | 'this-year';

// PDF 2026-07-02 (P1): se quitó "Este mes" (redundante con "Últimos 30 días").
// "Este trimestre" ahora muestra los últimos 3 meses (lógica en el backend).
const RANGE_OPTIONS: { value: RangeKind; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'this-week', label: 'Esta semana' },
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
    cancellationRate: number;
    pendingCommissionsUsd: number;
  };
  monthlySeries: Array<{
    label: string;
    mrrUsd: number;
    commPaidUsd: number;
    commPendingUsd: number;
  }>;
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

type BilledCompany = {
  kind: 'business' | 'group';
  id: string;
  name: string;
  plan: string;
  amountUsd: number;
  paidAt: string | null;
  status: string;
  estimated?: boolean;
};
type BilledCompaniesResp = {
  range: { kind: string; from: string; to: string };
  total: number;
  count: number;
  companies: BilledCompany[];
};

export function PremiumDashboard() {
  const [range, setRange] = useState<RangeKind>('last-30');
  const [data, setData] = useState<DashboardResp | null>(null);
  const [loading, setLoading] = useState(true);
  // P2: modal "Ver empresas" — lista exacta de negocios/grupos del facturado.
  const [showCompanies, setShowCompanies] = useState(false);
  const [companies, setCompanies] = useState<BilledCompaniesResp | null>(null);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const openCompanies = () => {
    setShowCompanies(true);
    setCompaniesLoading(true);
    api<BilledCompaniesResp>(`/admin/dashboard/billed-companies?range=${range}`)
      .then((r) => setCompanies(r))
      .catch(() => setCompanies(null))
      .finally(() => setCompaniesLoading(false));
  };
  // #17: los montos financieros se muestran OCULTOS por defecto. El 👁
  // los revela. La preferencia se persiste en localStorage por dispositivo.
  const [showAmounts, setShowAmounts] = useState(false);
  useEffect(() => {
    setShowAmounts(localStorage.getItem('dashboard.showAmounts') === '1');
  }, []);
  const toggleAmounts = () => {
    setShowAmounts((v) => {
      const next = !v;
      localStorage.setItem('dashboard.showAmounts', next ? '1' : '0');
      return next;
    });
  };
  // Enmascara cualquier monto cuando showAmounts=false.
  const money = (n: number) => (showAmounts ? usd(n) : '••••');

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

  // #13/#19 (2026-06-16): series REALES de los últimos 6 meses (backend
  // monthlySeries). Antes eran simuladas (buildSimulatedMrrSeries).
  const mrrSeries = useMemo(
    () =>
      (data?.monthlySeries ?? []).map((m) => ({
        label: m.label,
        value: m.mrrUsd,
      })),
    [data?.monthlySeries],
  );

  // Comisiones reales por mes: pagadas (paidAt) vs pendientes (generadas
  // en el mes, aún PENDING/APPROVED).
  const commSeries = useMemo(
    () =>
      (data?.monthlySeries ?? []).map((m) => ({
        label: m.label,
        Pagadas: m.commPaidUsd,
        Pendientes: m.commPendingUsd,
      })),
    [data?.monthlySeries],
  );

  if (loading && !data) {
    return <EmptyState text="Cargando dashboard…" icon="chart" />;
  }
  if (!data) {
    return <EmptyState text="No se pudo cargar el dashboard." />;
  }

  return (
    <div className="relative">
      {/* P2: Modal "Ver empresas" — auditoría del facturado del rango. */}
      {showCompanies && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 overflow-y-auto"
          onClick={() => setShowCompanies(false)}
        >
          <div
            className="bg-surface border border-line w-full max-w-2xl rounded-2xl shadow-md2 mt-10 mb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-line">
              <div>
                <div className="font-bold text-lg">Empresas facturadas</div>
                <div className="text-xs text-mute">
                  Rango: {RANGE_OPTIONS.find((r) => r.value === range)?.label} ·{' '}
                  {companies ? `${companies.count} unidades · total ${usd(companies.total)}` : '…'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCompanies(false)}
                className="text-mute hover:text-ink text-xl leading-none px-2"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {companiesLoading && (
                <div className="p-6 text-center text-mute text-sm">Cargando…</div>
              )}
              {!companiesLoading && companies && companies.companies.length === 0 && (
                <div className="p-6 text-center text-mute text-sm">
                  No hay empresas facturadas en este rango.
                </div>
              )}
              {!companiesLoading && companies && companies.companies.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-mute bg-bg2 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2">Empresa</th>
                      <th className="text-left px-2 py-2">Plan</th>
                      <th className="text-right px-2 py-2">Monto</th>
                      <th className="text-left px-4 py-2">Pago</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.companies.map((c) => (
                      <tr key={`${c.kind}-${c.id}`} className="border-t border-line">
                        <td className="px-4 py-2">
                          {c.kind === 'group' && (
                            <span className="mr-1" title="Grupo empresarial">👥</span>
                          )}
                          {c.name}
                          {c.estimated && (
                            <span className="ml-1 text-[10px] text-amber-500" title="Estimado (sin fecha de cobro registrada)">
                              ~est
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-mute capitalize">{c.plan.toLowerCase()}</td>
                        <td className="px-2 py-2 text-right font-semibold">{usd(c.amountUsd)}</td>
                        <td className="px-4 py-2 text-mute">
                          {c.paidAt ? fmtDate(c.paidAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

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
          <div className="flex items-start gap-6 flex-wrap">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-sky-200 font-semibold">
                Monto facturado
              </div>
              <div className="text-4xl md:text-5xl font-bold tracking-tight mt-1">
                {money(data.banner.billedUsd)}
              </div>
              <div className="text-xs text-sky-200 mt-1">
                Cobrado en: {RANGE_OPTIONS.find((r) => r.value === range)?.label}
              </div>
            </div>
            {/* Ingreso recurrente (MRR): SIEMPRE visible, no depende del rango.
                Refleja las mensualidades/recurrencia de los negocios activos aun
                cuando el rango (ej. "Hoy") no tenga cobros. */}
            <div className="md:border-l md:border-white/20 md:pl-6">
              <div className="text-[11px] uppercase tracking-wider text-sky-200 font-semibold">
                Ingreso recurrente / mes
              </div>
              <div className="text-3xl md:text-4xl font-bold tracking-tight mt-1">
                {money(data.kpis.mrrUsd)}
              </div>
              <div className="text-xs text-sky-200 mt-1">
                Mensualidades recurrentes (MRR)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={openCompanies}
              className="bg-white/10 border border-white/30 text-white rounded-pill px-3 py-2 text-sm font-semibold focus:outline-none hover:bg-white/20 transition"
            >
              🏢 Ver empresas
            </button>
            <button
              type="button"
              onClick={toggleAmounts}
              title={showAmounts ? 'Ocultar montos' : 'Mostrar montos'}
              aria-label={showAmounts ? 'Ocultar montos' : 'Mostrar montos'}
              className="bg-white/10 border border-white/30 text-white rounded-pill px-3 py-2 text-sm focus:outline-none hover:bg-white/20 transition"
            >
              {showAmounts ? '🙈' : '👁'}
            </button>
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
                {money(p.billingUsd)}
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
            (vs. mes anterior: {data.banner.newCustomers.lastMonth}{' '}
            {data.banner.newCustomers.lastMonth === 1 ? 'cliente' : 'clientes'})
          </span>
        </div>
      </div>

      {/* 3 KPIs glass (#16: se eliminó "Conversión Trial → Cliente") */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Kpi
          label="Ingreso recurrente"
          value={money(data.kpis.mrrUsd)}
          sub="MRR mensual"
          accent="brand"
          icon="💎"
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
          value={money(data.kpis.pendingCommissionsUsd)}
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
              <div className="text-[10px] text-mute mt-0.5">
                MRR estimado por antigüedad
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-mute">MRR</div>
              <div className="text-lg font-bold text-brand">
                {money(data.kpis.mrrUsd)}
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
            valueFormatter={(n) => money(n)}
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
                tickFormatter={(v) => money(Number(v))}
                width={50}
              />
              <Tooltip
                formatter={(v) => money(Number(v))}
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
                    {money(e.amountUsd)}
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
