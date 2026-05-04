'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Metrics = {
  tenants: number;
  activeTenants: number;
  trialTenants: number;
  suspendedTenants: number;
  expiringSoon: number;
  passes: number;
  customers: number;
  orders30: number;
  revenue30: number;
  mrrUsd: number;
  arrUsd: number;
  planBreakdown: Record<string, { count: number; mrr: number }>;
  churnedLast30: number;
  conversionRate30: number | null;
  newSignups7: number;
  pendingCommissions: number;
};

const KPI = ({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  tone?: 'neutral' | 'ok' | 'brand' | 'warn' | 'bad';
  href?: string;
}) => {
  const toneClass = {
    neutral: 'text-mute',
    ok: 'text-ok',
    brand: 'text-brand',
    warn: 'text-warn',
    bad: 'text-bad',
  }[tone];
  const valueClass = {
    neutral: 'text-ink',
    ok: 'text-ok',
    brand: 'text-brand',
    warn: 'text-warn',
    bad: 'text-bad',
  }[tone];
  const inner = (
    <div className="kpi h-full">
      <div className="kpi-top">
        <div className={`kpi-lbl ${toneClass}`}>
          <Icon name={icon} size={14} /> {label}
        </div>
      </div>
      <div className={`kpi-val ${valueClass}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:shadow-md transition rounded-card">
      {inner}
    </Link>
  ) : (
    inner
  );
};

export default function AdminDashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    api<Metrics>('/metrics/global').then(setM).catch(() => null);
  }, []);

  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const usdFmt = (n: number) =>
    `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Dashboard <span className="page-crumb">/ {today}</span>
        </h1>
      </div>

      {m && m.expiringSoon > 0 && (
        <div className="card card-pad bg-amber-50 border-amber-200 mb-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
            <Icon name="bell" size={16} />
          </div>
          <div className="flex-1 text-sm">
            <span className="font-semibold">{m.expiringSoon}</span> negocio
            {m.expiringSoon === 1 ? '' : 's'} sin confirmar pago hace más de 3 días.
          </div>
          <Link
            href="/admin/tenants"
            className="text-sm font-semibold text-amber-800 hover:underline"
          >
            Ver →
          </Link>
        </div>
      )}

      {/* Revenue: MRR + ARR + breakdown */}
      <div className="grid gap-3.5 grid-cols-1 md:grid-cols-3 mb-4">
        <KPI
          label="MRR"
          value={usdFmt(m?.mrrUsd ?? 0)}
          sub={
            m?.planBreakdown && Object.keys(m.planBreakdown).length > 0
              ? Object.entries(m.planBreakdown)
                  .map(([name, b]) => `${b.count} ${name}`)
                  .join(' · ')
              : 'sin negocios activos aún'
          }
          icon="cash"
          tone="brand"
        />
        <KPI
          label="ARR"
          value={usdFmt(m?.arrUsd ?? 0)}
          sub="MRR × 12"
          icon="cash"
          tone="ok"
        />
        <KPI
          label="Conversión 30d"
          value={
            m?.conversionRate30 !== null && m?.conversionRate30 !== undefined
              ? `${m.conversionRate30}%`
              : '—'
          }
          sub={`${m?.churnedLast30 ?? 0} churn este mes`}
          icon="spark"
          tone={
            m?.conversionRate30 !== null && m?.conversionRate30 !== undefined
              ? m.conversionRate30 >= 50
                ? 'ok'
                : m.conversionRate30 >= 25
                ? 'warn'
                : 'bad'
              : 'neutral'
          }
        />
      </div>

      {/* Revenue de pedidos + comisiones */}
      <div className="grid gap-3.5 grid-cols-1 md:grid-cols-2 mb-4">
        <KPI
          label="Revenue de pedidos 30d"
          value={`$${(m?.revenue30 ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`}
          sub={`${m?.orders30 ?? 0} pedidos en todos los negocios`}
          icon="shopping-bag"
          tone="ok"
        />
        <KPI
          label="Comisiones pendientes"
          value={`$${Number(m?.pendingCommissions ?? 0).toLocaleString('es-CO')}`}
          sub="por pagar a referrers"
          icon="gift"
          tone="warn"
          href="/admin/referrals"
        />
      </div>

      {/* Tenants pipeline */}
      <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
        Pipeline de negocios
      </div>
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4 mb-4">
        <KPI
          label="Total"
          value={m?.tenants ?? '–'}
          sub={`${m?.newSignups7 ?? 0} nuevos esta semana`}
          icon="store"
          href="/admin/tenants"
        />
        <KPI
          label="Activos"
          value={m?.activeTenants ?? '–'}
          sub="suscripción al día"
          icon="check"
          tone="ok"
          href="/admin/tenants"
        />
        <KPI
          label="Sin pago aún"
          value={m?.trialTenants ?? '–'}
          sub="esperando confirmación Hotmart"
          icon="spark"
          tone="brand"
          href="/admin/tenants"
        />
        <KPI
          label="Suspendidos"
          value={m?.suspendedTenants ?? '–'}
          sub="pago fallido o cancelado"
          icon="bell"
          tone="bad"
          href="/admin/tenants"
        />
      </div>

      {/* Activity */}
      <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
        Actividad acumulada
      </div>
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-3">
        <KPI
          label="Pases emitidos"
          value={m?.passes ?? '–'}
          sub="todos los tenants"
          icon="card"
          tone="brand"
        />
        <KPI
          label="Clientes finales"
          value={m?.customers ?? '–'}
          sub="acumulados"
          icon="users"
        />
        <KPI
          label="Pedidos 30d"
          value={m?.orders30 ?? '–'}
          sub="en todos los negocios"
          icon="shopping-bag"
          tone="ok"
        />
      </div>
    </div>
  );
}
