'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Pass = {
  id: string;
  serialNumber: string;
  stampsCount: number;
  pointsBalance: number;
  status: string;
  createdAt: string;
  card: { name: string; type: string; stampsRequired: number | null };
};

type Stamp = {
  id: string;
  action: string;
  amount: number;
  note: string | null;
  createdAt: string;
};

type Order = {
  id: string;
  code: string;
  status: string;
  total: number;
  paymentStatus: string;
  fulfillment: string;
  createdAt: string;
};

type Customer = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  tags: string[];
  marketingOptIn: boolean;
  whatsappVerified: boolean;
  totalOrdersCount: number;
  totalOrdersAmount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  createdAt: string;
  passes: Pass[];
  stamps: Stamp[];
  orders: Order[];
};

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function avatarClass(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}
function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}
function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Customer | null>(null);

  async function load() {
    setC(await api<Customer>(`/customers/${id}`));
  }
  useEffect(() => {
    load();
  }, [id]);

  if (!c) return <div className="text-mute">Cargando…</div>;

  const lifetimeAvg =
    c.totalOrdersCount > 0
      ? Number(c.totalOrdersAmount) / c.totalOrdersCount
      : 0;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/customers" className="text-mute hover:text-ink">
            Clientes
          </Link>{' '}
          <span className="page-crumb">/ {c.fullName}</span>
        </h1>
        {c.phone && (
          <a
            className="btn-primary"
            href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="send" /> WhatsApp
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Sidebar perfil */}
        <div className="space-y-4">
          <div className="card card-pad text-center">
            <div
              className={`avatar mx-auto w-20 h-20 text-2xl ${avatarClass(c.fullName)}`}
            >
              {initials(c.fullName)}
            </div>
            <div className="font-semibold text-lg mt-3">{c.fullName}</div>
            {c.phone && <div className="text-sm text-mute">{c.phone}</div>}
            {c.email && <div className="text-xs text-mute">{c.email}</div>}
            <div className="flex gap-1 justify-center flex-wrap mt-3">
              {c.whatsappVerified && (
                <span className="badge badge-ok text-[10px]">WA verif.</span>
              )}
              {c.marketingOptIn && (
                <span className="badge badge-info text-[10px]">Marketing OK</span>
              )}
              {c.tags.map((t) => (
                <span key={t} className="badge badge-mute text-[10px]">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-3">
              Lifetime value
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <div className="text-2xl font-bold">{c.totalOrdersCount}</div>
                <div className="text-xs text-mute">pedidos</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {COP(Number(c.totalOrdersAmount))}
                </div>
                <div className="text-xs text-mute">facturado</div>
              </div>
              <div>
                <div className="text-base font-semibold">{COP(lifetimeAvg)}</div>
                <div className="text-xs text-mute">ticket promedio</div>
              </div>
              <div>
                <div className="text-base font-semibold">
                  {c.passes.length}
                </div>
                <div className="text-xs text-mute">pases activos</div>
              </div>
            </div>
          </div>

          <div className="card card-pad text-sm">
            <div className="text-[10px] uppercase tracking-[0.18em] text-mute font-semibold mb-2">
              Datos
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Cliente desde</span>
              <span>{fmtDate(c.createdAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Primer pedido</span>
              <span>{fmtDate(c.firstOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line2">
              <span className="text-mute">Último pedido</span>
              <span>{fmtDate(c.lastOrderAt)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-mute">Cumpleaños</span>
              <span>{fmtDate(c.birthday)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Tarjetas */}
          {c.passes.length > 0 && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">
                Tarjetas de fidelización ({c.passes.length})
              </h3>
              <div className="grid gap-2">
                {c.passes.map((p) => (
                  <div
                    key={p.id}
                    className="border border-line2 rounded-lg p-3 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{p.card.name}</div>
                      <div className="text-xs text-mute">
                        {p.serialNumber} · {p.card.type}
                      </div>
                    </div>
                    {p.card.type === 'STAMPS' && (
                      <div className="text-right">
                        <div className="font-bold">
                          {p.stampsCount}/{p.card.stampsRequired ?? 10}
                        </div>
                        <div className="text-xs text-mute">sellos</div>
                      </div>
                    )}
                    {p.card.type === 'POINTS' && (
                      <div className="text-right">
                        <div className="font-bold">{p.pointsBalance}</div>
                        <div className="text-xs text-mute">puntos</div>
                      </div>
                    )}
                    <span
                      className={`badge ${
                        p.status === 'ACTIVE'
                          ? 'badge-ok'
                          : p.status === 'COMPLETED'
                          ? 'badge-info'
                          : 'badge-mute'
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pedidos */}
          <div className="card overflow-hidden">
            <div className="card-h">
              <h3>Historial de pedidos ({c.orders.length})</h3>
            </div>
            {c.orders.length === 0 ? (
              <div className="p-6 text-center text-mute text-sm">
                Aún no ha hecho pedidos
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-bg2">
                  <tr>
                    {['#', 'Fecha', 'Tipo', 'Pago', 'Estado', 'Total'].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2.5 text-[11px] uppercase tracking-[0.1em] text-mute font-semibold"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id} className="border-t border-line2">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/app/orders/${o.id}`}
                          className="text-brand hover:underline font-medium"
                        >
                          #{o.code}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-mute text-xs">
                        {fmtDate(o.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {o.fulfillment === 'PICKUP'
                          ? '🥡'
                          : o.fulfillment === 'DINE_IN'
                          ? '🍽'
                          : '🛵'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge text-[10px] ${
                            o.paymentStatus === 'PAID'
                              ? 'badge-ok'
                              : o.paymentStatus === 'PENDING'
                              ? 'badge-warn'
                              : 'badge-mute'
                          }`}
                        >
                          {o.paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`badge text-[10px] ${
                            o.status === 'DELIVERED'
                              ? 'badge-ok'
                              : o.status === 'CANCELLED'
                              ? 'bg-bad-soft text-bad-ink'
                              : 'badge-info'
                          }`}
                        >
                          {o.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium">
                        {COP(Number(o.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Sellos */}
          {c.stamps.length > 0 && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">
                Actividad de sellos ({c.stamps.length})
              </h3>
              <div className="space-y-1.5 text-sm">
                {c.stamps.slice(0, 15).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between py-1.5 border-b border-line2 last:border-0"
                  >
                    <div>
                      <span className="font-medium">{s.action}</span>
                      {s.note && (
                        <span className="text-xs text-mute ml-2">
                          {s.note}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-mute">
                      <span className="font-medium text-ink">
                        {Number(s.amount) > 0 ? '+' : ''}
                        {Number(s.amount)}
                      </span>
                      <span>{fmtDate(s.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
