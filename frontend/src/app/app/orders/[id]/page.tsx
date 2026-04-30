'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type OrderItem = {
  productId: string;
  variantId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  extras?: { name: string; price: number }[];
  note?: string;
};

type OrderEvent = {
  id: string;
  type: string;
  metadata: any;
  createdAt: string;
};

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  fulfillment: 'PICKUP' | 'DINE_IN' | 'DELIVERY';
  tableNumber: string | null;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  appliedPromos: any[];
  customerNote: string | null;
  whatsappLink: string | null;
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paymentMethod: string;
  paymentProvider: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  createdAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; fullName: string; phone: string; email: string | null };
  events: OrderEvent[];
  location: { id: string; name: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

const NEXT: Record<string, Order['status']> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'READY',
  READY: 'DELIVERED',
};

const NEXT_LABEL: Record<string, string> = {
  PENDING: 'Confirmar',
  CONFIRMED: 'Marcar listo',
  READY: 'Marcar entregado',
};

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);

function fmtDate(s: string) {
  return new Date(s).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setO(await api<Order>(`/orders/${id}`));
  }
  useEffect(() => {
    load();
  }, [id]);

  async function setStatus(next: Order['status']) {
    setBusy(true);
    try {
      await api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!o) return <div className="text-mute">Cargando…</div>;

  const flow = ['PENDING', 'CONFIRMED', 'READY', 'DELIVERED'] as const;
  const stamps: { label: string; at: string | null }[] = [
    { label: 'Creado', at: o.createdAt },
    { label: 'Confirmado', at: o.confirmedAt },
    { label: 'Listo', at: o.readyAt },
    { label: 'Entregado', at: o.deliveredAt },
  ];

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/orders" className="text-mute hover:text-ink">
            Pedidos
          </Link>{' '}
          <span className="page-crumb">/ #{o.code}</span>
        </h1>
        <div className="flex gap-2 items-center flex-wrap">
          <span
            className={`badge ${
              o.status === 'CANCELLED'
                ? 'bg-bad-soft text-bad-ink'
                : o.status === 'DELIVERED'
                ? 'badge-ok'
                : o.status === 'READY'
                ? 'badge-info'
                : o.status === 'CONFIRMED'
                ? 'badge-info'
                : 'badge-warn'
            }`}
          >
            {STATUS_LABEL[o.status]}
          </span>
          {NEXT[o.status] && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => setStatus(NEXT[o.status])}
            >
              <Icon name="arrow-right" /> {NEXT_LABEL[o.status]}
            </button>
          )}
          {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm('¿Cancelar este pedido?'))
                  setStatus('CANCELLED');
              }}
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Timeline visual */}
      <div className="card card-pad mb-4">
        <div className="grid grid-cols-4 gap-2">
          {flow.map((s, i) => {
            const st = stamps[i];
            const reached = !!st.at;
            return (
              <div key={s} className="flex flex-col items-center text-center">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm ${
                    reached ? 'bg-brand text-white' : 'bg-bg2 text-mute'
                  }`}
                >
                  {i + 1}
                </div>
                <div
                  className={`text-xs mt-1 font-medium ${reached ? 'text-ink' : 'text-mute'}`}
                >
                  {st.label}
                </div>
                {st.at && (
                  <div className="text-[10px] text-mute">{fmtDate(st.at)}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Items */}
        <div className="space-y-4">
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Items del pedido</h3>
            <div className="divide-y divide-line2">
              {o.items.map((it, i) => (
                <div key={i} className="py-3 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand-soft text-brand-700 flex items-center justify-center font-bold text-sm flex-none">
                    {it.qty}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{it.name}</div>
                    {it.extras && it.extras.length > 0 && (
                      <div className="text-xs text-mute mt-0.5">
                        {it.extras.map((e) => e.name).join(' · ')}
                      </div>
                    )}
                    {it.note && (
                      <div className="text-xs text-mute italic mt-1">
                        Nota: {it.note}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{COP(it.lineTotal)}</div>
                    <div className="text-xs text-mute">{COP(it.unitPrice)} c/u</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-line mt-3 pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-mute">
                <span>Subtotal</span>
                <span>{COP(Number(o.subtotal))}</span>
              </div>
              {Number(o.discount) > 0 && (
                <div className="flex justify-between text-ok">
                  <span>Descuento</span>
                  <span>−{COP(Number(o.discount))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1 border-t border-line">
                <span>Total</span>
                <span>{COP(Number(o.total))}</span>
              </div>
            </div>
          </div>

          {o.customerNote && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-2">Nota del cliente</h3>
              <p className="text-sm text-mute italic">"{o.customerNote}"</p>
            </div>
          )}

          {/* Timeline de eventos */}
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Actividad</h3>
            <div className="space-y-2.5 text-sm">
              {o.events.map((e) => (
                <div key={e.id} className="flex gap-3 items-start">
                  <div className="w-2 h-2 rounded-full bg-brand mt-1.5 flex-none" />
                  <div className="flex-1">
                    <div className="font-medium text-xs uppercase tracking-wider text-mute">
                      {e.type}
                    </div>
                    {e.metadata && Object.keys(e.metadata).length > 0 && (
                      <div className="text-xs text-mute mt-0.5">
                        {Object.entries(e.metadata)
                          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-mute whitespace-nowrap">
                    {fmtDate(e.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar derecho */}
        <div className="space-y-4">
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Cliente</h3>
            <Link
              href={`/app/customers/${o.customer.id}`}
              className="block hover:text-brand"
            >
              <div className="font-medium">{o.customer.fullName}</div>
            </Link>
            <div className="text-sm text-mute mt-1">{o.customer.phone}</div>
            {o.customer.email && (
              <div className="text-xs text-mute">{o.customer.email}</div>
            )}
            <div className="flex gap-2 mt-3">
              <a
                href={`https://wa.me/${o.customer.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost text-xs flex-1 justify-center"
              >
                <Icon name="send" /> WhatsApp
              </a>
            </div>
          </div>

          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Entrega</h3>
            <div className="text-sm">
              {o.fulfillment === 'PICKUP'
                ? '🥡 Para llevar'
                : o.fulfillment === 'DINE_IN'
                ? `🍽 Mesa ${o.tableNumber ?? ''}`
                : '🛵 Domicilio'}
            </div>
            {o.location && (
              <div className="text-xs text-mute mt-1">
                {o.location.name}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Pago</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-mute">Método</span>
              <span className="font-medium">{o.paymentMethod}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1.5">
              <span className="text-mute">Estado</span>
              <span
                className={`badge ${
                  o.paymentStatus === 'PAID'
                    ? 'badge-ok'
                    : o.paymentStatus === 'FAILED'
                    ? 'bg-bad-soft text-bad-ink'
                    : o.paymentStatus === 'PENDING'
                    ? 'badge-warn'
                    : 'badge-mute'
                } text-[10px]`}
              >
                {o.paymentStatus}
              </span>
            </div>
            {o.paidAt && (
              <div className="text-xs text-mute mt-2">
                Pagado el {fmtDate(o.paidAt)}
              </div>
            )}
            {o.paymentRef && (
              <div className="text-[11px] text-mute mt-1 truncate">
                Ref: <code>{o.paymentRef}</code>
              </div>
            )}
          </div>

          {o.whatsappLink && (
            <a
              href={o.whatsappLink}
              target="_blank"
              rel="noreferrer"
              className="card card-pad block hover:shadow-md transition"
            >
              <div className="font-semibold flex items-center gap-2">
                <Icon name="send" /> Mensaje WhatsApp listo
              </div>
              <div className="text-xs text-mute mt-1">
                Click para abrir el chat con el cliente
              </div>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
