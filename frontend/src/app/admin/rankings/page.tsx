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
import { useTranslations } from 'next-intl';
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

const ROLE_TITLE_KEY: Record<Role, string> = {
  INFLUENCER: 'roleTitleInfluencer',
  AMBASSADOR: 'roleTitleAmbassador',
  VENDOR: 'roleTitleVendor',
};

const METRIC_LABEL_KEY: Record<Metric, string> = {
  sales: 'metricSales',
  revenue: 'metricRevenue',
  commissions: 'metricCommissions',
};

const RANGE_LABEL_KEY: Record<Range, string> = {
  '7d': 'range7d',
  '30d': 'range30d',
  '90d': 'range90d',
  all: 'rangeAll',
};

const usd = (n: number) =>
  `$${Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default function RankingsPage() {
  const t = useTranslations('admin_rankings');
  const [range, setRange] = useState<Range>('30d');

  return (
    <div className="max-w-7xl">
      <div className="page-head">
        <h1 className="page-title">{t('title')}</h1>
      </div>

      <p className="text-mute text-sm mb-4 max-w-prose">{t('intro')}</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {(Object.keys(RANGE_LABEL_KEY) as Range[]).map((r) => (
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
            {t(RANGE_LABEL_KEY[r])}
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
  const t = useTranslations('admin_rankings');
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
      .catch((e) => toast(e?.message || t('errLoading'), 'error'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, metric, range]);

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{t(ROLE_TITLE_KEY[role])}</h2>
      </div>

      <div className="flex gap-1 mb-3 border-b border-line">
        {(Object.keys(METRIC_LABEL_KEY) as Metric[]).map((m) => (
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
            {t(METRIC_LABEL_KEY[m])}
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
          {t('noData')}
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
                    ? t('unitSales')
                    : metric === 'revenue'
                    ? t('unitRevenue')
                    : t('unitCommissions')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
