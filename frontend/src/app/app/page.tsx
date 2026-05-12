'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { KpiSkeleton, Skeleton } from '@/components/Skeleton';
import { InsightsCard } from '@/components/InsightsCard';
import { ActivityFeed } from '@/components/ActivityFeed';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';

type Metrics = {
  cards: number;
  customers: number;
  passes: number;
  installed: number;
  // Breakdown de plataforma wallet — cuántos clientes instalaron en
  // Apple vs Google. walletNone = los que tienen pase emitido pero no
  // tocaron el botón de wallet (escanearon QR físicamente).
  walletApple: number;
  walletGoogle: number;
  walletNone: number;
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
  avgRating: number | null;
  ratingsCount: number;
  avgRating30: number | null;
  ratingsCount30: number;
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

/** KPI específico para mostrar la división Apple vs Google de los pases
 *  instalados. Dos columnas con el ícono de cada plataforma. */
function WalletPlatformKPI({
  apple,
  google,
  none,
}: {
  apple: number;
  google: number;
  none: number;
}) {
  const totalInstalled = apple + google;
  const appleShare = totalInstalled > 0 ? Math.round((apple / totalInstalled) * 100) : 0;
  const googleShare = totalInstalled > 0 ? 100 - appleShare : 0;
  return (
    <div className="kpi">
      <div className="kpi-top">
        <div className="kpi-lbl text-info flex items-center gap-1">
          <Icon name="card" size={14} /> Apple vs Google
        </div>
      </div>
      <div className="flex items-baseline gap-3 mt-1">
        <div className="flex items-baseline gap-1">
          <span className="text-base">🍎</span>
          <span className="text-xl font-bold text-ink">{apple}</span>
          <span className="text-[10px] text-mute">({appleShare}%)</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-base">🤖</span>
          <span className="text-xl font-bold text-ink">{google}</span>
          <span className="text-[10px] text-mute">({googleShare}%)</span>
        </div>
      </div>
      {none > 0 && (
        <div className="kpi-sub">{none} sin instalar</div>
      )}
    </div>
  );
}

function Sparkline7d({ data }: { data: { date: string; orders: number; revenue: number }[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-xs text-mute py-8 text-center">Sin datos en los últimos 7 días</div>
    );
  }
  const last7 = data.slice(-7);
  const max = Math.max(...last7.map((d) => d.orders), 1);
  const W = 320;
  const H = 64;
  const step = W / Math.max(last7.length - 1, 1);
  const points = last7
    .map((d, i) => {
      const x = i * step;
      const y = H - (d.orders / max) * (H - 8) - 4;
      return `${x},${y}`;
    })
    .join(' ');
  const totalOrders = last7.reduce((acc, d) => acc + d.orders, 0);
  const peak = last7.reduce((m, d) => (d.orders > m.orders ? d : m), last7[0]);
  return (
    <div>
      <div className="flex items-end justify-between gap-2 mb-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-mute font-semibold">
            Pedidos últimos 7 días
          </div>
          <div className="text-2xl font-bold mt-0.5">{totalOrders}</div>
        </div>
        <div className="text-right text-xs text-mute">
          Pico:{' '}
          <span className="font-medium text-ink">
            {new Date(peak.date).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })}
            {' · '}
            {peak.orders}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`0,${H} ${points} ${W},${H}`}
          fill="url(#sparkfill)"
          stroke="none"
        />
        <polyline
          points={points}
          fill="none"
          stroke="#6366F1"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last7.map((d, i) => {
          const x = i * step;
          const y = H - (d.orders / max) * (H - 8) - 4;
          return <circle key={i} cx={x} cy={y} r="2.5" fill="#6366F1" />;
        })}
      </svg>
      <div className="flex justify-between mt-1 text-[10px] text-mute2">
        {last7.map((d) => (
          <div key={d.date}>
            {new Date(d.date).toLocaleDateString('es-CO', { weekday: 'narrow' })}
          </div>
        ))}
      </div>
    </div>
  );
}

function WelcomeTour({ tenant }: { tenant: any }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!tenant?.id) return;
    const key = `clubify:tour-seen:${tenant.id}`;
    if (typeof window === 'undefined') return;
    const seen = localStorage.getItem(key);
    if (!seen) setOpen(true);
  }, [tenant?.id]);

  function close() {
    if (tenant?.id && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`clubify:tour-seen:${tenant.id}`, '1');
      } catch {}
    }
    setOpen(false);
  }

  if (!open) return null;

  const steps = [
    {
      emoji: '👋',
      title: `¡Bienvenido${tenant?.brandName ? ', ' + tenant.brandName : ''}!`,
      body: 'En 3 pantallas te muestro lo principal. Esto solo te lo enseño una vez.',
    },
    {
      emoji: '💳',
      title: 'Mi tarjeta y mis clientes',
      body: 'En “Tarjetas” creas el programa de sellos o puntos. En “Clientes” ves quién las usa y puedes emitirles tarjetas digitales.',
    },
    {
      emoji: '🍴',
      title: 'Tu menú y los pedidos',
      body: 'En “Menú” cargas productos y desde su header tienes acceso a “Configura tu menú” para personalizar el storefront. Los pedidos llegan al kanban de “Pedidos” y se notifican por WhatsApp.',
    },
    {
      emoji: '📈',
      title: 'Crece y mide',
      body: 'En “Analítica” ves crecimiento. En “Push” mandas notificaciones a las tarjetas wallet. Aquí en el dashboard tienes un checklist de tareas pendientes.',
    },
  ];
  const cur = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/70" onClick={close} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-7 text-center">
        <div className="text-5xl mb-2" aria-hidden>
          {cur.emoji}
        </div>
        <h2 className="text-xl font-bold">{cur.title}</h2>
        <p className="text-sm text-mute mt-2 leading-relaxed">{cur.body}</p>

        <div className="flex justify-center gap-1.5 mt-5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full ${
                i === step ? 'bg-brand' : 'bg-bg2'
              }`}
            />
          ))}
        </div>

        <div className="mt-5 flex gap-2 justify-center">
          <button onClick={close} className="btn-ghost text-sm">
            Saltar
          </button>
          <button
            onClick={() => (last ? close() : setStep(step + 1))}
            className="btn-primary"
          >
            {last ? 'Empezar' : 'Siguiente →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// (Antiguo OnboardingChecklist local removido — ahora se usa el componente
// compartido de @/components/OnboardingChecklist que es server-driven.)

export default function TenantDashboard() {
  const [m, setM] = useState<Metrics | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [series, setSeries] = useState<{ date: string; orders: number; revenue: number }[]>([]);
  useEffect(() => {
    api<Metrics>('/metrics/tenant').then(setM).catch(() => null);
    api<any>('/tenants/me').then(setTenant).catch(() => null);
    api<{ date: string; orders: number; revenue: number }[]>(
      '/metrics/timeseries/orders?days=7',
    )
      .then(setSeries)
      .catch(() => null);
  }, []);

  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div>
      <WelcomeTour tenant={tenant} />
      <OnboardingChecklist />
      <InsightsCard />
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

      {/* Sparkline 7d */}
      {series.length > 0 && (
        <div className="card card-pad mb-5">
          <Sparkline7d data={series} />
        </div>
      )}

      {/* Bloque comercial */}
      <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
        Hoy
      </h2>
      {!m ? (
        <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
        </div>
      ) : (
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
      )}

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
        <WalletPlatformKPI
          apple={m?.walletApple ?? 0}
          google={m?.walletGoogle ?? 0}
          none={m?.walletNone ?? 0}
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
        <KPI
          label="★ Calificación"
          value={
            m?.avgRating != null ? (
              <span className="flex items-center gap-1">
                {m.avgRating.toFixed(1)}
                <span className="text-amber-500 text-xl leading-none">★</span>
              </span>
            ) : (
              '–'
            )
          }
          sub={
            m?.ratingsCount
              ? `${m.ratingsCount} pedidos calificados`
              : 'Aún sin calificaciones'
          }
          icon="spark"
          tone="info"
        />
      </div>

      {/* Bottom row: Top productos + Actividad */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        {m && m.topProducts.length > 0 ? (
          <div className="card">
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
        ) : (
          <div className="card card-pad text-center py-10">
            <div className="text-3xl mb-1">🏆</div>
            <div className="font-semibold text-sm">Top productos</div>
            <div className="text-xs text-mute mt-1 max-w-xs mx-auto">
              Cuando llegue el primer pedido, aquí verás tus productos más
              vendidos.
            </div>
          </div>
        )}

        <ActivityFeed />
      </div>
    </div>
  );
}
