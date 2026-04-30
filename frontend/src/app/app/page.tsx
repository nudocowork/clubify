'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Metrics = {
  cards: number;
  customers: number;
  passes: number;
  installed: number;
  stamps30: number;
  redemptions30: number;
  ordersToday: number;
  revenueToday: number;
  orders30: number;
  revenue30: number;
  revenue7: number;
  avgTicket: number;
  pendingOrders: number;
  newCustomers30: number;
  recurringCustomers30: number;
  topProducts: { id: string; name: string; count: number; category?: string }[];
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

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
  tone?: 'neutral' | 'ok' | 'brand' | 'info' | 'warn';
  href?: string;
}) => {
  const cls = {
    neutral: { l: 'text-mute', v: 'text-ink' },
    ok: { l: 'text-ok', v: 'text-ok' },
    brand: { l: 'text-brand', v: 'text-brand' },
    info: { l: 'text-info', v: 'text-info' },
    warn: { l: 'text-warn', v: 'text-warn' },
  }[tone];
  const inner = (
    <>
      <div className="kpi-top">
        <div className={`kpi-lbl ${cls.l}`}>
          <Icon name={icon} size={14} /> {label}
        </div>
      </div>
      <div className={`kpi-val ${cls.v}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="kpi block hover:shadow-md2 transition cursor-pointer">
      {inner}
    </Link>
  ) : (
    <div className="kpi">{inner}</div>
  );
};

export default function TenantDashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    api<Metrics>('/metrics/tenant').then(setM).catch(() => null);
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
        <div className="flex gap-2 flex-wrap">
          <Link className="btn-ghost" href="/app/notifications">
            <Icon name="bell" /> Push
          </Link>
          <Link className="btn-primary" href="/app/cards/new">
            <Icon name="plus" /> Crear tarjeta
          </Link>
        </div>
      </div>

      {/* Pendientes destacados */}
      {m && m.pendingOrders > 0 && (
        <Link
          href="/app/orders"
          className="card card-pad mb-5 block bg-warn-soft border-warn/30 hover:shadow-md2 transition"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-warn text-white flex items-center justify-center font-bold">
              {m.pendingOrders}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-warn-ink">
                {m.pendingOrders === 1
                  ? 'Tienes 1 pedido pendiente de confirmar'
                  : `Tienes ${m.pendingOrders} pedidos pendientes de confirmar`}
              </div>
              <div className="text-xs text-warn-ink/80">
                Ve al kanban para gestionarlos →
              </div>
            </div>
            <Icon name="arrow-right" className="text-warn-ink" />
          </div>
        </Link>
      )}

      {/* Bloque comercial */}
      <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
        Hoy
      </h2>
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4 mb-6">
        <KPI
          label="Pedidos hoy"
          value={m?.ordersToday ?? '–'}
          sub={`${m?.orders30 ?? 0} en 30d`}
          icon="shopping-bag"
          tone="brand"
          href="/app/orders"
        />
        <KPI
          label="Ingresos hoy"
          value={m ? fmt(m.revenueToday) : '–'}
          sub={`${m ? fmt(m.revenue7) : '–'} en 7d`}
          icon="cash"
          tone="ok"
        />
        <KPI
          label="Ticket promedio"
          value={m ? fmt(m.avgTicket) : '–'}
          sub="últimos 30 días"
          icon="trend-up"
          tone="info"
        />
        <KPI
          label="Ingresos 30d"
          value={m ? fmt(m.revenue30) : '–'}
          icon="cash"
          tone="ok"
        />
      </div>

      {/* Bloque clientes y fidelización */}
      <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
        Clientes y fidelización
      </h2>
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-6 mb-6">
        <KPI
          label="Clientes"
          value={m?.customers ?? '–'}
          sub={`+${m?.newCustomers30 ?? 0} este mes`}
          icon="users"
          href="/app/customers"
        />
        <KPI
          label="Recurrentes"
          value={m?.recurringCustomers30 ?? '–'}
          sub="≥2 pedidos"
          icon="users"
          tone="ok"
        />
        <KPI
          label="Tarjetas"
          value={m?.cards ?? '–'}
          icon="card"
          tone="brand"
          href="/app/cards"
        />
        <KPI
          label="Pases en Wallet"
          value={m?.installed ?? '–'}
          sub={`de ${m?.passes ?? 0} emitidos`}
          icon="check"
          tone="ok"
        />
        <KPI
          label="Sellos (30d)"
          value={m?.stamps30 ?? '–'}
          icon="check"
          tone="info"
        />
        <KPI
          label="Recompensas (30d)"
          value={m?.redemptions30 ?? '–'}
          icon="gift"
          tone="brand"
        />
      </div>

      {/* Top productos */}
      {m && m.topProducts.length > 0 && (
        <div className="card mb-5">
          <div className="card-h">
            <h3>Top productos · 30 días</h3>
            <Link className="btn-link" href="/app/menu">
              Ver menú
            </Link>
          </div>
          <div className="p-2">
            {m.topProducts.map((p, i) => {
              const max = m.topProducts[0]?.count || 1;
              const pct = (p.count / max) * 100;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg2 rounded-lg"
                >
                  <div className="w-6 h-6 rounded-full bg-brand-soft text-brand-700 flex items-center justify-center font-semibold text-xs flex-none">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{p.name}</div>
                    {p.category && (
                      <div className="text-xs text-mute">{p.category}</div>
                    )}
                  </div>
                  <div className="w-32 h-1.5 bg-line rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-sm font-semibold">
                    {p.count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
