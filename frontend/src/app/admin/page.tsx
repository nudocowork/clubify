'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Metrics = {
  tenants: number;
  activeTenants: number;
  passes: number;
  customers: number;
  pendingCommissions: number;
};

const KPI = ({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  tone?: 'neutral' | 'ok' | 'brand' | 'warn';
}) => {
  const toneClass = {
    neutral: 'text-mute',
    ok: 'text-ok',
    brand: 'text-brand',
    warn: 'text-warn',
  }[tone];
  const valueClass = {
    neutral: 'text-ink',
    ok: 'text-ok',
    brand: 'text-brand',
    warn: 'text-warn',
  }[tone];
  return (
    <div className="kpi">
      <div className="kpi-top">
        <div className={`kpi-lbl ${toneClass}`}>
          <Icon name={icon} size={14} /> {label}
        </div>
      </div>
      <div className={`kpi-val ${valueClass}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
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

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Dashboard <span className="page-crumb">/ {today}</span>
        </h1>
        <div className="flex gap-2">
          <button className="btn-ghost">
            <Icon name="trend-up" /> Reporte global
          </button>
        </div>
      </div>

      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4">
        <KPI
          label="Negocios activos"
          value={m?.activeTenants ?? '–'}
          sub={`de ${m?.tenants ?? 0} totales`}
          icon="store"
          tone="ok"
        />
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
          label="Comisiones pendientes"
          value={`$${Number(m?.pendingCommissions ?? 0).toLocaleString('es-CO')}`}
          sub="por pagar"
          icon="cash"
          tone="warn"
        />
      </div>
    </div>
  );
}
