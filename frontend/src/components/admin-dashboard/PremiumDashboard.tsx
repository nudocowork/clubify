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
    billedUsd: number; // COBRADO real (caja)
    estimatedUsd: number; // PROYECTADO (estimado, sin cobro registrado)
    estimatedCount: number;
    billedGroups: number; // cuántas unidades del facturado son Grupos
    billedByPlan: Array<{
      periodicity: string;
      label: string;
      count: number; // negocios + grupos con cobro real
      businessCount: number;
      groupCount: number;
      billingUsd: number; // cobrado real
      estimatedCount: number;
      estimatedUsd: number;
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
  // Fase 5: las 3 tarjetas de cobros (fuente única, mismo motor que suspende).
  cobros?: {
    proximos: { count: number; amountUsd: number };
    procesados: { count: number; amountUsd: number };
    noProcesados: { count: number; amountUsd: number };
    generatedAt: string;
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
  // Desglose Cobrado vs Estimado (Bug 1).
  realTotal: number;
  realCount: number;
  estimatedTotal: number;
  estimatedCount: number;
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
  // Fase 5: drill-down de las 3 tarjetas de cobros (modal con la tabla).
  const [cobrosBucket, setCobrosBucket] = useState<
    'proximos' | 'procesados' | 'no-procesados' | null
  >(null);
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

  // Bug 3 (auditoría 2026-08-17): si el rango cambia con el modal "Ver empresas"
  // ABIERTO, refetchear la lista para que no quede pegada al rango anterior.
  // (openCompanies ya usa el rango actual AL ABRIR; esto cubre tenerlo abierto.)
  useEffect(() => {
    if (!showCompanies) return;
    setCompaniesLoading(true);
    api<BilledCompaniesResp>(`/admin/dashboard/billed-companies?range=${range}`)
      .then((r) => setCompanies(r))
      .catch(() => setCompanies(null))
      .finally(() => setCompaniesLoading(false));
    // showCompanies fuera de deps a propósito: al abrir ya fetchea openCompanies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                  Rango: {RANGE_OPTIONS.find((r) => r.value === range)?.label}
                  {companies ? (
                    <>
                      {' · '}
                      <span className="text-emerald-600 font-semibold">
                        Cobrado {usd(companies.realTotal)} ({companies.realCount})
                      </span>
                      {companies.estimatedCount > 0 && (
                        <>
                          {' · '}
                          <span className="text-amber-600 font-semibold">
                            Estimado {usd(companies.estimatedTotal)} ({companies.estimatedCount})
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    ' · …'
                  )}
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
                      <th className="text-left px-4 py-2">Estado</th>
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
                        </td>
                        <td className="px-2 py-2 text-mute capitalize">{c.plan.toLowerCase()}</td>
                        <td className="px-2 py-2 text-right font-semibold">{usd(c.amountUsd)}</td>
                        <td className="px-4 py-2 text-mute">
                          {c.paidAt ? fmtDate(c.paidAt) : '—'}
                        </td>
                        {/* Bug 1: estado como badge propio, no como sufijo pegado al nombre. */}
                        <td className="px-4 py-2">
                          {c.estimated ? (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-pill bg-amber-100 text-amber-700"
                              title="Sin fecha de cobro registrada; el monto es el precio de lista, no caja real."
                            >
                              Estimado
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-pill bg-emerald-100 text-emerald-700">
                              Cobrado
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Bug 1: pie del modal con el desglose Cobrado vs Estimado. */}
            {!companiesLoading && companies && companies.companies.length > 0 && (
              <div className="p-3 border-t border-line text-xs flex flex-wrap gap-x-4 gap-y-1 justify-end">
                <span className="text-emerald-600">
                  <strong>Cobrado:</strong> {companies.realCount} · {usd(companies.realTotal)}
                </span>
                {companies.estimatedCount > 0 && (
                  <span className="text-amber-600">
                    <strong>Estimado:</strong> {companies.estimatedCount} · {usd(companies.estimatedTotal)}
                  </span>
                )}
              </div>
            )}
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
          <div>
            <div className="text-[11px] uppercase tracking-wider text-sky-200 font-semibold">
              Cobrado
            </div>
            <div className="text-4xl md:text-5xl font-bold tracking-tight mt-1">
              {money(data.banner.billedUsd)}
            </div>
            <div className="text-xs text-sky-200 mt-1">
              Pagos con fecha real · {RANGE_OPTIONS.find((r) => r.value === range)?.label}
            </div>
            {/* Bug 1: lo proyectado (estimado, sin cobro registrado) NUNCA se
                suma dentro de "Cobrado" — se muestra aparte y diferenciado. */}
            {data.banner.estimatedUsd > 0 && (
              <div
                className="text-xs text-amber-200 mt-1"
                title="Negocios ACTIVE sin fecha de cobro registrada. El monto es el precio de lista (proyección), no caja real."
              >
                + Proyectado (sin cobro registrado): {money(data.banner.estimatedUsd)}
                {' · '}
                {data.banner.estimatedCount}{' '}
                {data.banner.estimatedCount === 1 ? 'negocio' : 'negocios'}
              </div>
            )}
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
              {/* Bug 4/5: "negocios" = tenants con su ÚLTIMO cobro en el rango
                  (no acumula renovaciones); los grupos se cuentan aparte. */}
              <div
                className="text-[10px] text-sky-200"
                title="Negocios con su último cobro en el rango. No incluye renovaciones previas del mismo negocio."
              >
                {p.businessCount} negocios
                {p.groupCount > 0
                  ? ` · ${p.groupCount} grupo${p.groupCount === 1 ? '' : 's'}`
                  : ''}
              </div>
              {p.estimatedUsd > 0 && (
                <div
                  className="text-[10px] text-amber-200/90"
                  title="Proyectado (sin cobro registrado), no incluido en el Cobrado."
                >
                  + {money(p.estimatedUsd)} est · {p.estimatedCount}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Clientes nuevos del mes con variación */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm">
            {/* Bug 7: esta métrica es SIEMPRE del mes calendario, NO del rango
                seleccionado arriba. Se rotula explícito para no confundir. */}
            <span className="text-sky-200">
              Clientes nuevos <span className="opacity-80">(este mes calendario)</span>:
            </span>{' '}
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

      {/* Fase 5: 3 tarjetas de COBROS (fuente única — mismo motor que suspende).
          Reemplazan MRR / Tasa cancelación / Comisiones pendientes. Clickeables:
          abren el detalle con la lista y filtros de fecha. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <CobroCard
          color="blue"
          icon="🔵"
          label="Próximos cobros"
          value={money(data.cobros?.proximos.amountUsd ?? 0)}
          sub={`${data.cobros?.proximos.count ?? 0} cobros · próximos 7 días`}
          onClick={() => setCobrosBucket('proximos')}
        />
        <CobroCard
          color="green"
          icon="🟢"
          label="Pagos procesados"
          value={money(data.cobros?.procesados.amountUsd ?? 0)}
          sub={`${data.cobros?.procesados.count ?? 0} pagos · últimos 7 días`}
          onClick={() => setCobrosBucket('procesados')}
        />
        <CobroCard
          color="red"
          icon="🔴"
          label="Pagos no procesados"
          value={money(data.cobros?.noProcesados.amountUsd ?? 0)}
          sub={`${data.cobros?.noProcesados.count ?? 0} · fallidos o vencidos`}
          onClick={() => setCobrosBucket('no-procesados')}
        />
      </div>

      {cobrosBucket && (
        <CobrosDrilldown
          bucket={cobrosBucket}
          money={money}
          onClose={() => setCobrosBucket(null)}
        />
      )}

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

// Fase 5 — tarjeta de cobros clickeable (🔴🟢🟡).
function CobroCard({
  color,
  icon,
  label,
  value,
  sub,
  onClick,
}: {
  color: 'red' | 'green' | 'amber' | 'blue';
  icon: string;
  label: string;
  value: string;
  sub: string;
  onClick: () => void;
}) {
  const border = {
    red: 'border-t-red-500',
    green: 'border-t-emerald-500',
    amber: 'border-t-amber-500',
    blue: 'border-t-blue-500',
  }[color];
  const text = {
    red: 'text-red-600',
    green: 'text-emerald-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
  }[color];
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl backdrop-blur bg-white/80 border border-white/60 border-t-[3px] ${border} shadow-md2 p-4 transition hover:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          {label}
        </div>
        <span className="text-lg">{icon}</span>
      </div>
      <div className={`text-2xl font-bold mt-1 ${text}`}>{value}</div>
      <div className="text-[11px] text-mute mt-0.5">{sub}</div>
      <div className={`text-[11px] font-semibold mt-2 ${text}`}>Ver detalle →</div>
    </button>
  );
}

// Fase 5 — detalle (drill-down) de una tarjeta de cobros.
type CobroRowAny = {
  tenantId?: string | null;
  negocio?: string;
  esGrupo?: boolean;
  fechaCobro?: string | null;
  fechaPrevista?: string | null;
  fecha?: string | null;
  periodicidad?: string;
  montoUsd?: number;
  metodo?: string;
  pasarela?: string;
  tipo?: string;
  estado?: string;
  graceLabel?: string | null;
  diasVencidos?: number;
};

function CobrosDrilldown({
  bucket,
  money,
  onClose,
}: {
  bucket: 'proximos' | 'procesados' | 'no-procesados';
  money: (n: number) => string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<CobroRowAny[]>([]);
  const [loading, setLoading] = useState(true);
  // "no-procesados" abre en "Todos" para que la lista cuadre con el conteo de la
  // tarjeta (incluye suspensiones viejas, que el rango de días recortaría).
  const [range, setRange] = useState(bucket === 'no-procesados' ? 'todos' : '7d');
  const title = {
    proximos: '🔵 Próximos cobros',
    procesados: '🟢 Pagos procesados',
    'no-procesados': '🔴 Pagos no procesados',
  }[bucket];
  const chips: Array<[string, string]> =
    bucket === 'proximos'
      ? [
          ['hoy', 'Hoy'],
          ['7d', 'Próx. 7 días'],
          ['15d', '15 días'],
          ['30d', '30 días'],
        ]
      : bucket === 'no-procesados'
        ? [
            ['todos', 'Todos'],
            ['7d', 'Últimos 7 días'],
            ['15d', '15 días'],
            ['30d', '30 días'],
          ]
        : [
            ['hoy', 'Hoy'],
            ['7d', 'Últimos 7 días'],
            ['15d', '15 días'],
            ['30d', '30 días'],
          ];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<CobroRowAny[]>(`/admin/dashboard/cobros/${bucket}?range=${range}`)
      .then((r) => {
        if (!cancelled) {
          setRows(Array.isArray(r) ? r : []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bucket, range]);

  const fmtD = (s?: string | null) =>
    s
      ? new Date(s).toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'short',
        })
      : '—';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl max-w-4xl w-full p-5 shadow-xl my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink text-xl">
            ✕
          </button>
        </div>
        <div className="text-xs text-mute mb-3">
          {rows.length} {rows.length === 1 ? 'registro' : 'registros'}
        </div>
        <div className="flex gap-1.5 flex-wrap mb-3">
          {chips.map(([v, lbl]) => (
            <button
              key={v}
              onClick={() => setRange(v)}
              className={`text-xs px-3 py-1 rounded-full border transition ${
                range === v
                  ? 'bg-brand/10 border-brand text-brand font-semibold'
                  : 'border-line2 text-mute hover:text-ink'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto border border-line2 rounded-lg">
          {loading ? (
            <div className="p-8 text-center text-mute text-sm">Cargando…</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-mute text-sm">
              Sin resultados en este rango.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
                {bucket === 'proximos' && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fecha cobro</th>
                    <th className="px-3 py-2 font-semibold">Negocio</th>
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 font-semibold text-right">Monto</th>
                    <th className="px-3 py-2 font-semibold">Método</th>
                  </tr>
                )}
                {bucket === 'procesados' && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Fecha</th>
                    <th className="px-3 py-2 font-semibold">Negocio</th>
                    <th className="px-3 py-2 font-semibold">Tipo</th>
                    <th className="px-3 py-2 font-semibold text-right">Monto</th>
                    <th className="px-3 py-2 font-semibold">Pasarela</th>
                  </tr>
                )}
                {bucket === 'no-procesados' && (
                  <tr>
                    <th className="px-3 py-2 font-semibold">Negocio</th>
                    <th className="px-3 py-2 font-semibold">Vence</th>
                    <th className="px-3 py-2 font-semibold text-center">Días</th>
                    <th className="px-3 py-2 font-semibold">Gracia</th>
                    <th className="px-3 py-2 font-semibold text-right">Monto</th>
                    <th className="px-3 py-2 font-semibold">Método</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line2">
                    {bucket === 'proximos' && (
                      <>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtD(r.fechaCobro)}
                        </td>
                        <td className="px-3 py-2 font-medium">
                          {r.negocio}
                          {r.esGrupo && (
                            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">
                              Grupo
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-mute">{r.periodicidad}</td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {money(r.montoUsd ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-mute">{r.metodo}</td>
                      </>
                    )}
                    {bucket === 'procesados' && (
                      <>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtD(r.fecha)}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.negocio}</td>
                        <td className="px-3 py-2 text-mute">{r.tipo}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">
                          {money(r.montoUsd ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-mute">{r.pasarela}</td>
                      </>
                    )}
                    {bucket === 'no-procesados' && (
                      <>
                        <td className="px-3 py-2 font-medium">{r.negocio}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {fmtD(r.fechaPrevista)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {r.diasVencidos}
                        </td>
                        <td className="px-3 py-2">
                          {r.estado === 'SUSPENDIDO' ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                              SUSPENDIDO
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                              {r.graceLabel ?? 'En gracia'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {money(r.montoUsd ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-mute">{r.metodo}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
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
