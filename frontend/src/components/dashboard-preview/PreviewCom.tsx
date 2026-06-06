'use client';

/**
 * Preview 3 — COMERCIAL (estilo Hubspot).
 * Leaderboards (influencers / embajadores / vendedores) + funnel.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { KpiCard } from './KpiCard';
import { EmptyState } from './EmptyState';
import {
  usePreviewData,
  usd,
  type RankingResponse,
  type RankingRow,
} from './shared';

type AllRanks = {
  influencers: RankingRow[];
  ambassadors: RankingRow[];
  vendors: RankingRow[];
};

export function PreviewCom() {
  const { global, dashboard, trialMetrics, loading } = usePreviewData();
  const [ranks, setRanks] = useState<AllRanks | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [i, a, v] = await Promise.allSettled([
        api<RankingResponse>('/admin/rankings?role=INFLUENCER&metric=revenue&range=30d'),
        api<RankingResponse>('/admin/rankings?role=AMBASSADOR&metric=sales&range=30d'),
        api<RankingResponse>('/admin/rankings?role=VENDOR&metric=commissions&range=30d'),
      ]);
      if (cancelled) return;
      setRanks({
        influencers: i.status === 'fulfilled' ? i.value.rows : [],
        ambassadors: a.status === 'fulfilled' ? a.value.rows : [],
        vendors: v.status === 'fulfilled' ? v.value.rows : [],
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Top campañas: aproximamos como bySource (Landing/Direct/Ambassador/etc).
  // TODO: cuando exista endpoint /admin/campaigns/top reemplazar.
  const topCampanas = (() => {
    if (!trialMetrics) return [];
    return Object.entries(trialMetrics.bySource)
      .map(([source, data]) => ({
        source,
        total: data.total,
        converted: data.converted,
        conversionPct: data.conversionPct,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  })();

  const totalComisiones =
    (dashboard?.comisionesGeneradasMesUsd ?? 0) +
    (dashboard?.comisionesPendientesUsd ?? 0);

  const conversionPct = trialMetrics?.conversionPct ?? null;

  if (loading && !ranks) {
    return <EmptyState text="Cargando rankings comerciales…" icon="chart" />;
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-ink">Vista comercial</h2>
        <p className="text-sm text-mute mt-1">
          Top performers de la red y funnel de conversión trial → cliente.
        </p>
      </div>

      {/* KPIs hero */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KpiCard
          label="Comisiones generadas"
          value={usd(dashboard?.comisionesGeneradasMesUsd)}
          sub="este mes"
          tone="brand"
          icon="💰"
        />
        <KpiCard
          label="Comisiones pendientes"
          value={usd(dashboard?.comisionesPendientesUsd)}
          sub="por pagar"
          tone="warn"
          icon="⏳"
        />
        <KpiCard
          label="Comisiones pagadas"
          value={usd(dashboard?.comisionesPagadasMesUsd)}
          sub="este mes"
          tone="ok"
          icon="✅"
        />
        <KpiCard
          label="Conversión trials"
          value={conversionPct != null ? `${conversionPct}%` : '—'}
          sub={`${trialMetrics?.counts.converted ?? 0} convertidos / ${
            trialMetrics?.counts.total ?? 0
          } trials`}
          tone={
            conversionPct == null
              ? 'neutral'
              : conversionPct >= 50
              ? 'ok'
              : conversionPct >= 25
              ? 'warn'
              : 'bad'
          }
          icon="🎯"
        />
      </div>

      {/* Layout 2 cols */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Izquierda: leaderboards (2/3) */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Leaderboard
            title="Top influencers"
            subtitle="por facturación 30d"
            rows={ranks?.influencers ?? []}
            metric="revenue"
          />
          <Leaderboard
            title="Top embajadores"
            subtitle="por ventas 30d"
            rows={ranks?.ambassadors ?? []}
            metric="sales"
          />
          <Leaderboard
            title="Top vendedores"
            subtitle="por comisiones 30d"
            rows={ranks?.vendors ?? []}
            metric="commissions"
          />
          <CampaignBoard rows={topCampanas} />
        </div>

        {/* Derecha: funnel (1/3) */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl bg-white border border-line2 p-5">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">
              Comisiones · funnel
            </div>
            <div className="text-base font-bold text-ink mb-4">Estado total</div>
            <FunnelBar
              label="Generadas"
              value={dashboard?.comisionesGeneradasMesUsd ?? 0}
              max={totalComisiones || 1}
              color="bg-brand"
            />
            <FunnelBar
              label="Pagadas"
              value={dashboard?.comisionesPagadasMesUsd ?? 0}
              max={totalComisiones || 1}
              color="bg-ok"
            />
            <FunnelBar
              label="Pendientes"
              value={dashboard?.comisionesPendientesUsd ?? 0}
              max={totalComisiones || 1}
              color="bg-warn"
            />
          </div>

          <div className="rounded-xl bg-white border border-line2 p-5">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">
              Conversión Trial → Cliente
            </div>
            <div className="text-base font-bold text-ink mb-4">
              {conversionPct != null ? `${conversionPct}%` : 'sin datos'}
            </div>
            <Donut value={conversionPct ?? 0} />
            <div className="mt-3 text-xs text-mute text-center">
              {trialMetrics?.counts.converted ?? 0} convirtieron ·{' '}
              {trialMetrics?.counts.expired ?? 0} vencieron
            </div>
          </div>

          <div className="rounded-xl bg-white border border-line2 p-5">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-3">
              Pipeline negocios
            </div>
            <PipelineRow
              label="Activos"
              value={global?.activeTenants ?? 0}
              tone="ok"
            />
            <PipelineRow
              label="Trials"
              value={global?.trialTenants ?? 0}
              tone="warn"
            />
            <PipelineRow
              label="Suspendidos"
              value={global?.suspendedTenants ?? 0}
              tone="bad"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Leaderboard({
  title,
  subtitle,
  rows,
  metric,
}: {
  title: string;
  subtitle: string;
  rows: RankingRow[];
  metric: 'sales' | 'revenue' | 'commissions';
}) {
  return (
    <div className="rounded-xl bg-white border border-line2 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            {title}
          </div>
          <div className="text-sm font-bold text-ink mt-0.5">{subtitle}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-mute py-3">Sin datos en este periodo.</div>
      ) : (
        <ul className="divide-y divide-line2">
          {rows.slice(0, 5).map((r) => (
            <li
              key={r.id}
              className="py-2.5 flex items-center justify-between gap-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 w-6 text-center">
                  {medalFor(r.rank)}
                </span>
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.ownerName}</div>
                  <div className="text-[10px] text-mute truncate">
                    {r.code}
                  </div>
                </div>
              </div>
              <div className="shrink-0 font-semibold text-brand">
                {metric === 'sales'
                  ? r.sales
                  : metric === 'revenue'
                  ? usd(r.revenueUsd)
                  : usd(r.commissionsUsd)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignBoard({
  rows,
}: {
  rows: Array<{
    source: string;
    total: number;
    converted: number;
    conversionPct: number | null;
  }>;
}) {
  return (
    <div className="rounded-xl bg-white border border-line2 p-5">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1">
        Top campañas
      </div>
      <div className="text-sm font-bold text-ink mb-3">por volumen total</div>
      {rows.length === 0 ? (
        <div className="text-xs text-mute py-3">
          Sin campañas con tracking aún.
        </div>
      ) : (
        <ul className="divide-y divide-line2">
          {rows.map((c) => (
            <li
              key={c.source}
              className="py-2.5 flex items-center justify-between gap-2 text-sm"
            >
              <div className="font-medium">{labelSource(c.source)}</div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-mute">{c.total} signups</span>
                <span className="font-semibold text-brand">
                  {c.conversionPct != null ? `${c.conversionPct}%` : '—'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="text-[10px] text-mute mt-2">
        {/* TODO: cuando exista /admin/campaigns/top con datos UTM reales, reemplazar. */}
        Derivado de trial.bySource.
      </div>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-mute">{label}</span>
        <span className="font-semibold text-ink">{usd(value)}</span>
      </div>
      <div className="h-2 rounded-pill bg-bg2 overflow-hidden">
        <div
          className={`h-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Donut({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 50;
  const circ = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circ;
  return (
    <div className="flex items-center justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="#EEF0F3"
          strokeWidth="14"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="#22C55E"
          strokeWidth="14"
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
        />
        <text
          x="70"
          y="76"
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill="#0F172A"
        >
          {clamped}%
        </text>
      </svg>
    </div>
  );
}

function PipelineRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'warn' | 'bad';
}) {
  const cls =
    tone === 'ok'
      ? 'text-ok bg-ok-soft'
      : tone === 'warn'
      ? 'text-warn bg-warn-soft'
      : 'text-bad bg-bad-soft';
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ink">{label}</span>
      <span
        className={`px-2 py-0.5 rounded-pill text-xs font-semibold ${cls}`}
      >
        {value}
      </span>
    </div>
  );
}

function medalFor(rank: number) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return <span className="text-xs text-mute font-semibold">{rank}</span>;
}

function labelSource(s: string) {
  const map: Record<string, string> = {
    LANDING: 'Landing',
    AMBASSADOR: 'Embajadores',
    INFLUENCER: 'Influencers',
    CAMPAIGN: 'Campañas',
    DIRECT: 'Directo',
  };
  return map[s] ?? s;
}
