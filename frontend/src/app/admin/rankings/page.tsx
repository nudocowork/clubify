'use client';

/**
 * /admin/rankings — Top influencers / embajadores / vendedores con
 * 3 métricas (ventas, facturación, comisiones) y 4 rangos temporales
 * (7d, 30d, 90d, all-time).
 *
 * 3 cards en columna (responsive a single column en mobile). Cada card
 * tiene un selector de tabs (metric) + un selector de range (chip pills).
 * El estado del range se mantiene global a la página para sincronizar
 * los 3 paneles.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Role = 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR';
type Metric = 'sales' | 'revenue' | 'commissions';
type Range = '7d' | '30d' | '90d' | 'all';

type RankingRow = {
  rank: number;
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  commissionPercent: number;
  sales: number;
  revenueUsd: number;
  commissionsUsd: number;
};

type RankingResponse = {
  role: Role;
  metric: Metric;
  range: Range;
  rows: RankingRow[];
};

const ROLE_TITLE: Record<Role, string> = {
  INFLUENCER: 'Top Influencers',
  AMBASSADOR: 'Top Embajadores',
  VENDOR: 'Top Vendedores',
};

const METRIC_LABEL: Record<Metric, string> = {
  sales: 'Por ventas',
  revenue: 'Por facturación',
  commissions: 'Por comisiones',
};

const RANGE_LABEL: Record<Range, string> = {
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
  all: 'All-time',
};

const usd = (n: number) =>
  `$${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default function RankingsPage() {
  const [range, setRange] = useState<Range>('30d');

  return (
    <div className="max-w-7xl">
      <div className="page-head">
        <h1 className="page-title">Rankings</h1>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">
        Top performers de la red por rol. Cambia la métrica con los tabs y
        el rango temporal con los pills.
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={
              'px-3 py-1.5 rounded-full text-sm cursor-pointer select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] ' +
              (range === r
                ? 'bg-brand text-white font-semibold'
                : 'bg-bg2 text-ink hover:bg-bg2/80')
            }
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <RankingCard role="INFLUENCER" range={range} />
        <RankingCard role="AMBASSADOR" range={range} />
        <RankingCard role="VENDOR" range={range} />
      </div>
    </div>
  );
}

function RankingCard({ role, range }: { role: Role; range: Range }) {
  const [metric, setMetric] = useState<Metric>('sales');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      role,
      metric,
      range,
      limit: '10',
    });
    api<RankingResponse>(`/admin/rankings?${params.toString()}`)
      .then(setData)
      .catch((e) => toast(e?.message || 'Error cargando ranking', 'error'))
      .finally(() => setLoading(false));
  }, [role, metric, range]);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{ROLE_TITLE[role]}</h2>
      </div>

      <div className="flex gap-1 mb-3 border-b border-line">
        {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            className={
              'px-2 py-1.5 text-xs font-medium transition border-b-2 cursor-pointer select-none [-webkit-tap-highlight-color:transparent] ' +
              (metric === m
                ? 'border-brand text-brand'
                : 'border-transparent text-mute hover:text-ink')
            }
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 bg-bg2 rounded animate-shimmer" />
          ))}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-sm text-mute text-center py-6">
          Sin datos en este rango.
        </div>
      ) : (
        <ul className="space-y-1">
          {data.rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 px-2 py-2 rounded hover:bg-bg2/40 transition"
            >
              <span
                className={
                  'w-6 text-right font-bold tabular-nums ' +
                  (row.rank === 1
                    ? 'text-brand'
                    : row.rank === 2
                    ? 'text-warn'
                    : row.rank === 3
                    ? 'text-ok'
                    : 'text-mute')
                }
              >
                {row.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{row.ownerName}</div>
                <div className="text-xs text-mute truncate">{row.code}</div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm font-semibold">
                  {metric === 'sales'
                    ? row.sales
                    : metric === 'revenue'
                    ? usd(row.revenueUsd)
                    : usd(row.commissionsUsd)}
                </div>
                <div className="text-xs text-mute">
                  {metric === 'sales'
                    ? 'ventas'
                    : metric === 'revenue'
                    ? 'facturación'
                    : 'comisiones'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
