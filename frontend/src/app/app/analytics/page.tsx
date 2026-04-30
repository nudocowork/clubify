'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
  const [days, setDays] = useState(30);
  const [orderFunnel, setOrderFunnel] = useState<Funnel | null>(null);
  const [loyaltyFunnel, setLoyaltyFunnel] = useState<Funnel | null>(null);
  const [customerFunnel, setCustomerFunnel] = useState<Funnel | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);

  async function load() {
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
  }
  useEffect(() => {
    load();
  }, [days]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Analítica{' '}
          <span className="page-crumb">/ funnels & series</span>
        </h1>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {orderFunnel && (
          <FunnelCard
            title="Funnel de pedidos"
            subtitle={`Últimos ${days} días${
              orderFunnel.cancelRate !== undefined
                ? ` · ${orderFunnel.cancelRate}% cancelados`
                : ''
            }`}
            funnel={orderFunnel}
            color="#6366F1"
          />
        )}
        {loyaltyFunnel && (
          <FunnelCard
            title="Funnel de fidelización"
            subtitle="Acumulado total"
            funnel={loyaltyFunnel}
            color="#10B981"
          />
        )}
        {customerFunnel && (
          <FunnelCard
            title="Funnel de clientes"
            subtitle={
              customerFunnel.repeatRate !== undefined
                ? `Tasa recurrencia: ${customerFunnel.repeatRate}%`
                : 'Acumulado'
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
              Pedidos & ingresos por día
              <span className="text-mute text-sm font-normal ml-2">
                ({series.days}d)
              </span>
            </h3>
            <div className="text-sm text-mute">
              {series.series.reduce((a, s) => a + s.count, 0)} pedidos ·{' '}
              {COP(series.series.reduce((a, s) => a + Number(s.total), 0))}
            </div>
          </div>
          <Sparkline series={series.series} />
        </div>
      )}

      {heatmap && (
        <div className="card card-pad mt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">
              Heatmap (cuándo te piden más)
              <span className="text-mute text-sm font-normal ml-2">
                últimos 30 días · {heatmap.total} pedidos
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

function HeatGrid({ heatmap }: { heatmap: Heatmap }) {
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
                {heatmap.days[i]}
              </td>
              {row.map((v, h) => {
                const intensity = heatmap.max === 0 ? 0 : v / heatmap.max;
                const bg = `rgba(99, 102, 241, ${intensity * 0.95 + (v ? 0.05 : 0)})`;
                return (
                  <td
                    key={h}
                    title={`${heatmap.days[i]} ${h}:00 — ${v} pedidos`}
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
