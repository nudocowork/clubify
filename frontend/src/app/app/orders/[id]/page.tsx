'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

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
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
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
    try {
      setO(await api<Order>(`/orders/${id}`));
    } catch (e: any) {
      toast(e.message || 'Error cargando pedido', 'error');
    }
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
      toast(`Pedido marcado como ${STATUS_LABEL[next]}`, 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el estado', 'error');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Marca el pago de delivery como PAID y abre wa.me al courier (si está
   * configurado en /app/settings → Mensajería de WhatsApp). Si no hay
   * número de courier, solo marca el pago y avisa que falta config.
   */
  async function acceptDeliveryPayment() {
    if (!confirm('¿Aceptar pago de este pedido y despachar al courier?')) return;
    setBusy(true);
    try {
      const res = await api<{ courierLink: string; courierConfigured: boolean }>(
        `/orders/${id}/accept-delivery-payment`,
        { method: 'POST' },
      );
      await load();
      if (res.courierConfigured && res.courierLink) {
        toast('Pago aceptado · abriendo WhatsApp al courier…', 'success');
        window.open(res.courierLink, '_blank');
      } else {
        toast(
          'Pago aceptado. Configura el WhatsApp del courier en Mi cuenta para despachar automático.',
          'info',
        );
      }
    } catch (e: any) {
      toast(e.message || 'No se pudo aceptar el pago', 'error');
    } finally {
      setBusy(false);
    }
  }

  function printAs(mode: 'ticket' | 'receipt') {
    document.body.dataset.printMode = mode;
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        delete document.body.dataset.printMode;
      }, 500);
    }, 50);
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
     <div className="print-hide">
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
          <PrintMenu onPrint={printAs} />
          {NEXT[o.status] && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => setStatus(NEXT[o.status])}
            >
              <Icon name="arrow-right" /> {NEXT_LABEL[o.status]}
            </button>
          )}
          {o.fulfillment === 'DELIVERY' &&
            o.paymentStatus !== 'PAID' &&
            o.status !== 'CANCELLED' && (
              <button
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white text-sm font-semibold px-3.5 py-2 rounded-pill hover:bg-emerald-700 transition disabled:opacity-50"
                disabled={busy}
                onClick={acceptDeliveryPayment}
                title="Marca pago como cobrado y abre WhatsApp al courier de domicilio"
              >
                ✓ Aceptar pago + despachar 🛵
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

          {o.rating && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-2">Calificación del cliente</h3>
              <div className="flex items-center gap-2">
                <div className="text-2xl">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span
                      key={i}
                      style={{ color: i < o.rating! ? '#F59E0B' : '#E5E7EB' }}
                    >
                      ★
                    </span>
                  ))}
                </div>
                <span className="text-sm text-mute">
                  {o.rating}/5
                  {o.ratedAt &&
                    ` · ${new Date(o.ratedAt).toLocaleDateString('es-CO', {
                      day: '2-digit',
                      month: 'short',
                    })}`}
                </span>
              </div>
              {o.ratingComment && (
                <p className="text-sm text-mute italic mt-2 border-l-2 border-line2 pl-3">
                  "{o.ratingComment}"
                </p>
              )}
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

     {/* Ticket para imprimir — solo visible en window.print() */}
     <KitchenTicket order={o} />
     <CustomerReceipt order={o} />
    </div>
  );
}

function KitchenTicket({ order }: { order: Order }) {
  const fulfillmentLabel =
    order.fulfillment === 'PICKUP'
      ? 'PARA LLEVAR'
      : order.fulfillment === 'DINE_IN'
      ? `MESA ${order.tableNumber ?? '?'}`
      : 'DOMICILIO';

  return (
    <div className="print-only">
      <div className="ticket">
        <div className="ticket-head">
          <div className="ticket-code">#{order.code}</div>
          <div className="ticket-fulfillment">{fulfillmentLabel}</div>
        </div>
        <div className="ticket-meta">
          {new Date(order.createdAt).toLocaleString('es-CO', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' · '}
          {order.customer.fullName}
          {' · '}
          {order.customer.phone}
        </div>

        <div className="ticket-divider" />

        <div className="ticket-items">
          {order.items.map((it, i) => (
            <div key={i} className="ticket-item">
              <div className="ticket-item-line">
                <span className="ticket-qty">{it.qty}×</span>
                <span className="ticket-name">{it.name}</span>
              </div>
              {it.extras && it.extras.length > 0 && (
                <div className="ticket-extras">
                  + {it.extras.map((e) => e.name).join(', ')}
                </div>
              )}
              {it.note && <div className="ticket-note">📝 {it.note}</div>}
            </div>
          ))}
        </div>

        {order.customerNote && (
          <>
            <div className="ticket-divider" />
            <div className="ticket-customer-note">
              <strong>Nota cliente:</strong> {order.customerNote}
            </div>
          </>
        )}

        <div className="ticket-divider" />
        <div className="ticket-total">
          <span>TOTAL</span>
          <span>
            {new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0,
            }).format(Number(order.total))}
          </span>
        </div>
        <div className="ticket-foot">
          {order.paymentStatus === 'PAID' ? '✓ PAGADO' : 'COBRAR EN ENTREGA'}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Menú de impresión (ticket cocina / recibo cliente)
// =====================================================
function PrintMenu({
  onPrint,
}: {
  onPrint: (mode: 'ticket' | 'receipt') => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function close() {
      setOpen(false);
    }
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="relative">
      <button
        className="btn-ghost"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Imprimir"
      >
        🖨 Imprimir ▾
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 bg-white rounded-lg shadow-card border border-line2 w-56 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setOpen(false);
              onPrint('ticket');
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-bg2 flex items-start gap-2"
          >
            <span>👨‍🍳</span>
            <div>
              <div className="font-medium">Ticket cocina</div>
              <div className="text-[11px] text-mute">80mm térmico</div>
            </div>
          </button>
          <div className="border-t border-line2" />
          <button
            onClick={() => {
              setOpen(false);
              onPrint('receipt');
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-bg2 flex items-start gap-2"
          >
            <span>🧾</span>
            <div>
              <div className="font-medium">Recibo cliente</div>
              <div className="text-[11px] text-mute">A5 con marca</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function CustomerReceipt({ order }: { order: Order }) {
  return (
    <div className="receipt-only">
      <div className="receipt">
        <div className="receipt-head">
          <div className="receipt-brand">CLUBIFY</div>
          <div className="receipt-code">Pedido #{order.code}</div>
          <div className="receipt-date">
            {new Date(order.createdAt).toLocaleString('es-CO', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>

        <div className="receipt-section">
          <div className="receipt-label">Cliente</div>
          <div className="receipt-row">
            <span>{order.customer.fullName}</span>
            <span>{order.customer.phone}</span>
          </div>
          {order.customer.email && (
            <div className="receipt-row receipt-meta">
              <span>{order.customer.email}</span>
            </div>
          )}
        </div>

        <div className="receipt-section">
          <div className="receipt-label">Detalles</div>
          <div className="receipt-row">
            <span>Tipo</span>
            <span>
              {order.fulfillment === 'PICKUP'
                ? 'Para llevar'
                : order.fulfillment === 'DINE_IN'
                ? `Mesa ${order.tableNumber ?? ''}`
                : 'Domicilio'}
            </span>
          </div>
          {order.location && (
            <div className="receipt-row">
              <span>Sucursal</span>
              <span>{order.location.name}</span>
            </div>
          )}
        </div>

        <div className="receipt-items">
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="left">Producto</th>
                <th className="right">Cant.</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={i}>
                  <td className="left">
                    <div>{it.name}</div>
                    {it.extras && it.extras.length > 0 && (
                      <div className="receipt-extras">
                        + {it.extras.map((e) => e.name).join(', ')}
                      </div>
                    )}
                    {it.note && <div className="receipt-extras">{it.note}</div>}
                  </td>
                  <td className="right">{it.qty}</td>
                  <td className="right">
                    {new Intl.NumberFormat('es-CO', {
                      style: 'currency',
                      currency: 'COP',
                      maximumFractionDigits: 0,
                    }).format(Number(it.lineTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="receipt-totals">
          <div className="receipt-row">
            <span>Subtotal</span>
            <span>
              {new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 0,
              }).format(Number(order.subtotal))}
            </span>
          </div>
          {Number(order.discount) > 0 && (
            <div className="receipt-row">
              <span>Descuento</span>
              <span>
                −{' '}
                {new Intl.NumberFormat('es-CO', {
                  style: 'currency',
                  currency: 'COP',
                  maximumFractionDigits: 0,
                }).format(Number(order.discount))}
              </span>
            </div>
          )}
          <div className="receipt-row receipt-total">
            <span>TOTAL</span>
            <span>
              {new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 0,
              }).format(Number(order.total))}
            </span>
          </div>
          <div className="receipt-row receipt-meta">
            <span>Estado pago</span>
            <span>
              {order.paymentStatus === 'PAID' ? '✓ Pagado' : 'Pendiente'}
            </span>
          </div>
        </div>

        {order.customerNote && (
          <div className="receipt-section">
            <div className="receipt-label">Nota</div>
            <div>{order.customerNote}</div>
          </div>
        )}

        <div className="receipt-foot">
          ¡Gracias por tu compra! Vuelve pronto.
        </div>
      </div>
    </div>
  );
}
