'use client';

/**
 * Preview 1 — CEO DASHBOARD (estilo Stripe).
 * Métricas grandes, mucho whitespace, foco en revenue.
 */

import { useMemo } from 'react';
import { KpiCard } from './KpiCard';
import { MiniLineChart } from './MiniLineChart';
import { EmptyState } from './EmptyState';
import {
  usePreviewData,
  usd,
  buildSimulatedMrrSeries,
} from './shared';

export function PreviewCeo() {
  const { global, dashboard, loading } = usePreviewData();

  const mrrSeries = useMemo(
    () => buildSimulatedMrrSeries(global?.mrrUsd ?? 0, 6),
    [global?.mrrUsd],
  );

  // Conversiones del mes: aproximamos como activeTenants ajustado por
  // conversionRate30 si existe; sino 0.
  // TODO: cuando exista endpoint /admin/metrics/conversions-30d real.
  const conversionsMonth = useMemo(() => {
    if (!global) return 0;
    if (global.conversionRate30 == null) return 0;
    // newSignups7 * 4 estimación + ajustada por conversion
    return Math.round((global.newSignups7 * 4 * global.conversionRate30) / 100);
  }, [global]);

  // Ventas del mes: dashboard.salesByPlan suma counts (negocios cobrados).
  const salesMonth = useMemo(() => {
    if (!dashboard) return 0;
    return dashboard.salesByPlan.reduce((a, p) => a + p.count, 0);
  }, [dashboard]);

  if (loading && !global) {
    return <EmptyState text="Cargando métricas ejecutivas…" icon="chart" />;
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-ink">Resumen ejecutivo</h2>
        <p className="text-sm text-mute mt-1">
          Métricas de salud financiera y crecimiento del negocio.
        </p>
      </div>

      {/* KPIs hero: 2 grandes + 4 pequeños */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <KpiCard
          label="MRR"
          value={usd(global?.mrrUsd ?? 0)}
          sub="Ingresos recurrentes mensuales"
          tone="brand"
          icon="💰"
        />
        <KpiCard
          label="ARR"
          value={usd(global?.arrUsd ?? 0)}
          sub="MRR × 12"
          tone="ok"
          icon="📈"
        />
        <KpiCard
          label="Negocios activos"
          value={global?.activeTenants ?? 0}
          sub="suscripción al día"
          icon="🏪"
        />
        <KpiCard
          label="Suspendidos"
          value={global?.suspendedTenants ?? 0}
          sub="pago fallido o cancelado"
          tone="bad"
          icon="🚫"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Trials activos"
          value={global?.trialTenants ?? 0}
          sub="esperando confirmación"
          tone="warn"
          icon="🎁"
        />
        <KpiCard
          label="Conversiones del mes"
          value={conversionsMonth}
          sub={
            global?.conversionRate30 != null
              ? `tasa ${global.conversionRate30}%`
              : 'sin datos de conversión'
          }
          tone="info"
          icon="✅"
        />
        <KpiCard
          label="Comisiones pendientes"
          value={usd(global?.pendingCommissions ?? 0)}
          sub="por pagar a afiliados"
          tone="warn"
          icon="💸"
        />
        <KpiCard
          label="Ventas del mes"
          value={salesMonth}
          sub={`${global?.newSignups7 ?? 0} signups esta semana`}
          tone="brand"
          icon="🛒"
        />
      </div>

      {/* Chart MRR 6m */}
      <div className="rounded-xl bg-white border border-line2 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              Tendencia MRR
            </div>
            <div className="text-lg font-bold text-ink mt-0.5">
              Últimos 6 meses
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-mute">MRR actual</div>
            <div className="text-xl font-bold text-brand">
              {usd(global?.mrrUsd ?? 0)}
            </div>
          </div>
        </div>
        <MiniLineChart
          data={mrrSeries}
          height={220}
          color="#22C55E"
          showAxes
          showGrid
          valueFormatter={(n) => usd(n)}
        />
        <div className="text-[10px] text-mute mt-2">
          Serie estimada con crecimiento promedio del 15% mensual. {/* */}
          {/* TODO: cuando exista endpoint /admin/metrics/mrr-history reemplazar. */}
        </div>
      </div>
    </div>
  );
}
