'use client';
import { PanelHeader } from '@/components/PanelHeader';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ActionsMenu } from '@/components/ActionsMenu';
import { descargarCsv, descargarXlsx, type Celda } from '@/lib/exportar-hoja';

type Funnel = {
  stages: { key: string; label: string; count: number; pct: number }[];
  cancelled?: number;
  cancelRate?: number;
  repeatRate?: number;
};

type Series = {
  days: number;
  series: { date: string; count: number; total: number }[];
};

type Heatmap = {
  days: string[];
  cells: number[][];
  max: number;
  total: number;
};

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

export default function AnalyticsPage() {
  const t = useTranslations('app_analytics');
  const locale = useLocale();
  const [days, setDays] = useState(30);
  const [orderFunnel, setOrderFunnel] = useState<Funnel | null>(null);
  const [loyaltyFunnel, setLoyaltyFunnel] = useState<Funnel | null>(null);
  const [customerFunnel, setCustomerFunnel] = useState<Funnel | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);

  async function load() {
    try {
      const [a, b, c, d, e] = await Promise.all([
        api<Funnel>(`/metrics/funnel/orders?days=${days}`),
        api<Funnel>('/metrics/funnel/loyalty'),
        api<Funnel>('/metrics/funnel/customers'),
        api<Series>(`/metrics/timeseries/orders?days=${days}`),
        api<Heatmap>('/metrics/heatmap/orders'),
      ]);
      setOrderFunnel(a);
      setLoyaltyFunnel(b);
      setCustomerFunnel(c);
      setSeries(d);
      setHeatmap(e);
    } catch (e: any) {
      toast(e.message || t('loadError'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, [days]);

  // ¿La cuenta tiene actividad? Si todos los funnels están en 0, mostramos
  // empty state explicativo en vez de gráficas vacías.
  const noActivity =
    orderFunnel &&
    loyaltyFunnel &&
    customerFunnel &&
    orderFunnel.stages[0]?.count === 0 &&
    loyaltyFunnel.stages[0]?.count === 0 &&
    customerFunnel.stages[0]?.count === 0;

  /**
   * Descarga lo mismo que se ve en pantalla, con el periodo elegido. Se arma
   * en el navegador con los datos ya cargados: no hace falta otro endpoint y
   * lo descargado coincide exactamente con lo que el negocio está mirando.
   */
  function exportar(formato: 'xlsx' | 'csv') {
    if (!orderFunnel || !loyaltyFunnel || !customerFunnel || !series || !heatmap) {
      toast(t('exportNothing'), 'error');
      return;
    }
    const dia = new Date().toISOString().slice(0, 10);
    const porDia: Celda[][] = [
      [t('colDate'), t('colOrders'), t('colRevenue')],
      ...series.series.map((s) => [s.date, s.count, Number(s.total)]),
    ];
    if (formato === 'csv') {
      descargarCsv(`analitica-pedidos-${days}d-${dia}.csv`, porDia);
      return;
    }
    const embudos: Celda[][] = [[t('colFunnel'), t('colPeriod'), t('colStage'), t('colCount'), t('colPctPrev')]];
    const agregar = (nombre: string, periodo: string, f: Funnel) => {
      f.stages.forEach((s, i) =>
        embudos.push([nombre, periodo, s.label, s.count, i === 0 ? null : Number(s.pct.toFixed(1))]),
      );
      if (f.cancelled !== undefined) embudos.push([nombre, periodo, t('rowCancelled'), f.cancelled, null]);
      if (f.cancelRate !== undefined) embudos.push([nombre, periodo, t('rowCancelRate'), f.cancelRate, null]);
      if (f.repeatRate !== undefined) embudos.push([nombre, periodo, t('rowRepeatRate'), f.repeatRate, null]);
    };
    agregar(t('orderFunnel'), t('lastDays', { days }), orderFunnel);
    agregar(t('loyaltyFunnel'), t('allTime'), loyaltyFunnel);
    agregar(t('customerFunnel'), t('cumulative'), customerFunnel);
    const horas = Array.from({ length: 24 }, (_, h) => `${h}:00`);
    const calor: Celda[][] = [
      [t('colDay'), ...horas, t('colTotal')],
      ...heatmap.cells.map((fila, i) => [
        nombreDelDia(locale, i),
        ...fila,
        fila.reduce((a, v) => a + v, 0),
      ]),
    ];
    descargarXlsx(`analitica-${dia}.xlsx`, [
      { nombre: t('sheetFunnels'), filas: embudos },
      { nombre: `${t('sheetDaily')} (${days}d)`, filas: porDia },
      { nombre: t('sheetHeatmap'), filas: calor },
    ]);
  }

  return (
    <div>
      <PanelHeader
        tutorial="analitica"
        title={t('title')}
        crumb={t('crumb')}
      />
      <div className="page-head justify-end gap-2">
        <ActionsMenu
          label={<>⤓ {t('export')} ▾</>}
          buttonClassName="btn-ghost text-xs shrink-0 whitespace-nowrap"
          menuWidth={220}
        >
          {(close) => (
            <>
              {(
                [
                  ['xlsx', t('exportExcel')],
                  ['csv', t('exportCsvDaily')],
                ] as const
              ).map(([formato, etiqueta]) => (
                <button
                  key={formato}
                  type="button"
                  onClick={() => {
                    close();
                    exportar(formato);
                  }}
                  className="block w-full text-left text-xs font-semibold px-3 py-2 text-ink transition hover:bg-gray-50"
                >
                  {etiqueta}
                </button>
              ))}
            </>
          )}
        </ActionsMenu>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                days === d ? 'bg-brand text-white' : 'bg-bg2 text-mute'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {noActivity && (
        <div className="card card-pad text-center py-12 mb-4">
          <div className="text-5xl mb-2">📊</div>
          <div className="font-bold text-lg">{t('emptyTitle')}</div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            {t('emptyBody')}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/app/storefront" className="btn-primary text-sm">
              {t('shareSite')}
            </Link>
            <Link href="/app/customers" className="btn-ghost text-sm">
              {t('firstCustomer')}
            </Link>
            <Link href="/app/cards" className="btn-ghost text-sm">
              {t('setUpCard')}
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {orderFunnel && (
          <FunnelCard
            title={t('orderFunnel')}
            subtitle={
              t('lastDays', { days }) +
              (orderFunnel.cancelRate !== undefined
                ? ` · ${t('cancelRate', { rate: orderFunnel.cancelRate })}`
                : '')
            }
            funnel={orderFunnel}
            color="#6366F1"
          />
        )}
        {loyaltyFunnel && (
          <FunnelCard
            title={t('loyaltyFunnel')}
            subtitle={t('allTime')}
            funnel={loyaltyFunnel}
            color="#10B981"
          />
        )}
        {customerFunnel && (
          <FunnelCard
            title={t('customerFunnel')}
            subtitle={
              customerFunnel.repeatRate !== undefined
                ? t('repeatRate', { rate: customerFunnel.repeatRate })
                : t('cumulative')
            }
            funnel={customerFunnel}
            color="#F97316"
          />
        )}
      </div>

      {series && (
        <div className="card card-pad mt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              {t('ordersAndRevenue')}
              <span className="text-mute text-sm font-normal ml-2">
                ({series.days}d)
              </span>
            </h3>
            <div className="text-sm text-mute">
              {t('ordersAndTotal', {
                count: series.series.reduce((a, s) => a + s.count, 0),
                total: COP(
                  series.series.reduce((a, s) => a + Number(s.total), 0),
                ),
              })}
            </div>
          </div>
          <Sparkline series={series.series} />
        </div>
      )}

      {heatmap && (
        <div className="card card-pad mt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              {t('heatmapTitle')}
              <span className="text-mute text-sm font-normal ml-2">
                {t('heatmapSub', { count: heatmap.total })}
              </span>
            </h3>
          </div>
          <HeatGrid heatmap={heatmap} />
        </div>
      )}
    </div>
  );
}

function FunnelCard({
  title,
  subtitle,
  funnel,
  color,
}: {
  title: string;
  subtitle: string;
  funnel: Funnel;
  color: string;
}) {
  const top = funnel.stages[0]?.count ?? 0;
  return (
    <div className="card card-pad">
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-mute mb-3">{subtitle}</div>
      <div className="space-y-2.5">
        {funnel.stages.map((s, i) => {
          const widthPct = top === 0 ? 0 : (s.count / top) * 100;
          return (
            <div key={s.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">{s.label}</span>
                <span className="text-mute">
                  <strong className="text-ink">{s.count}</strong>
                  {i > 0 && (
                    <span className="ml-2">· {s.pct.toFixed(1)}%</span>
                  )}
                </span>
              </div>
              <div className="h-2 bg-bg2 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${widthPct}%`,
                    background: color,
                    opacity: 1 - i * 0.12,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({
  series,
}: {
  series: { date: string; count: number; total: number }[];
}) {
  const W = 800;
  const H = 140;
  const PAD = 24;
  const max = Math.max(1, ...series.map((s) => s.count));
  const totalMax = Math.max(1, ...series.map((s) => Number(s.total)));
  const stepX = (W - PAD * 2) / Math.max(1, series.length - 1);

  const pointsCount = series
    .map((s, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - ((s.count / max) * (H - PAD * 2));
      return `${x},${y}`;
    })
    .join(' ');

  const areaPath = `M${PAD},${H - PAD} L${series
    .map(
      (s, i) =>
        `${PAD + i * stepX},${
          H - PAD - (Number(s.total) / totalMax) * (H - PAD * 2)
        }`,
    )
    .join(' L')} L${W - PAD},${H - PAD} Z`;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[160px] min-w-[600px]">
        <defs>
          <linearGradient id="rev" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#rev)" />
        <polyline
          points={pointsCount}
          fill="none"
          stroke="#6366F1"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {series.map((s, i) => {
          const x = PAD + i * stepX;
          const y = H - PAD - (s.count / max) * (H - PAD * 2);
          return (
            <g key={s.date}>
              <circle cx={x} cy={y} r={2.5} fill="#6366F1" />
              {(i === 0 || i === series.length - 1 || s.count === max) && (
                <text
                  x={x}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#6B7280"
                >
                  {s.count > 0 ? s.count : ''}
                </text>
              )}
            </g>
          );
        })}
        {/* x-axis labels: first, middle, last */}
        {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
          <text
            key={i}
            x={PAD + i * stepX}
            y={H - 4}
            textAnchor="middle"
            fontSize="10"
            fill="#9CA3AF"
          >
            {series[i]?.date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

// Los nombres de los días los manda el backend en español fijo («Dom»,
// «Lun»…). Se rehacen con el idioma activo: es texto que se lee, y en un
// negocio en inglés quedaba en medio de una tabla traducida. 2026-01-04 es
// domingo, que es donde empieza la semana del backend.
function nombreDelDia(locale: string, i: number) {
  return new Date(Date.UTC(2026, 0, 4 + i)).toLocaleDateString(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  });
}

function HeatGrid({ heatmap }: { heatmap: Heatmap }) {
  const t = useTranslations('app_analytics');
  const locale = useLocale();
  const HOURS = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] text-mute">
        <thead>
          <tr>
            <th className="px-1"></th>
            {HOURS.map((h) => (
              <th key={h} className="px-0.5 font-normal text-center">
                {h % 3 === 0 ? h : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.cells.map((row, i) => (
            <tr key={i}>
              <td className="px-1.5 py-0.5 text-right font-medium text-ink">
                {nombreDelDia(locale, i)}
              </td>
              {row.map((v, h) => {
                const intensity = heatmap.max === 0 ? 0 : v / heatmap.max;
                const bg = `rgba(99, 102, 241, ${intensity * 0.95 + (v ? 0.05 : 0)})`;
                return (
                  <td
                    key={h}
                    title={t('heatCellTitle', {
                      day: nombreDelDia(locale, i),
                      hour: h,
                      count: v,
                    })}
                    className="text-center text-[9px] text-white align-middle"
                    style={{
                      background: v ? bg : '#F4F5F7',
                      width: 22,
                      height: 22,
                      minWidth: 22,
                      borderRadius: 3,
                    }}
                  >
                    {v > 0 ? v : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
