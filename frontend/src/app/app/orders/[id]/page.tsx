'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { DeliveryChat, type ChatMessage } from '@/components/DeliveryChat';

type OrderItem = {
  productId: string;
  variantId?: string | null;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  extras?: { id?: string; name: string; price: number }[];
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
  // Presencia del delivery: el chat del domicilio solo aparece si existe.
  delivery: { status: string } | null;
};

const STATUS_LABEL_KEY: Record<string, string> = {
  PENDING: 'statusPending',
  CONFIRMED: 'statusConfirmed',
  READY: 'statusReady',
  DELIVERED: 'statusDelivered',
  CANCELLED: 'statusCancelled',
};

const NEXT: Record<string, Order['status']> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'READY',
  READY: 'DELIVERED',
};

const NEXT_LABEL_KEY: Record<string, string> = {
  PENDING: 'nextConfirm',
  CONFIRMED: 'nextMarkReady',
  READY: 'nextMarkDelivered',
};

const PAYMENT_STATUS_LABEL_KEY: Record<string, string> = {
  NOT_REQUIRED: 'payStatusNotRequired',
  PENDING: 'payStatusPending',
  PAID: 'payStatusPaid',
  FAILED: 'payStatusFailed',
  REFUNDED: 'payStatusRefunded',
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
  const t = useTranslations('app_orders_id');
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function load() {
    try {
      setO(await api<Order>(`/orders/${id}`));
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
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
      toast(t('toastStatusChanged', { status: t(STATUS_LABEL_KEY[next]) }), 'success');
    } catch (e: any) {
      toast(e.message || t('errorStatusChange'), 'error');
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
    if (!confirm(t('confirmAcceptDelivery'))) return;
    setBusy(true);
    try {
      const res = await api<{ courierLink: string; courierConfigured: boolean }>(
        `/orders/${id}/accept-delivery-payment`,
        { method: 'POST' },
      );
      await load();
      if (res.courierConfigured && res.courierLink) {
        toast(t('toastPaymentAcceptedCourier'), 'success');
        window.open(res.courierLink, '_blank');
      } else {
        toast(t('toastPaymentAcceptedNoCourier'), 'info');
      }
    } catch (e: any) {
      toast(e.message || t('errorAcceptPayment'), 'error');
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

  if (!o) return <div className="text-mute">{t('loading')}</div>;

  const flow = ['PENDING', 'CONFIRMED', 'READY', 'DELIVERED'] as const;
  const stamps: { label: string; at: string | null }[] = [
    { label: t('stampCreated'), at: o.createdAt },
    { label: t('stampConfirmed'), at: o.confirmedAt },
    { label: t('stampReady'), at: o.readyAt },
    { label: t('stampDelivered'), at: o.deliveredAt },
  ];

  return (
    <div>
     <div className="print-hide">
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/orders" className="text-mute hover:text-ink">
            {t('breadcrumbOrders')}
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
            {t(STATUS_LABEL_KEY[o.status])}
          </span>
          <PrintMenu onPrint={printAs} />
          {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => setEditing(true)}
              title={t('editOrder')}
            >
              ✏️ {t('editOrder')}
            </button>
          )}
          {NEXT[o.status] && (
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => setStatus(NEXT[o.status])}
            >
              <Icon name="arrow-right" /> {t(NEXT_LABEL_KEY[o.status])}
            </button>
          )}
          {o.fulfillment === 'DELIVERY' &&
            o.paymentStatus !== 'PAID' &&
            o.status !== 'CANCELLED' && (
              <button
                className="inline-flex items-center gap-1.5 bg-emerald-600 text-white text-sm font-semibold px-3.5 py-2 rounded-pill hover:bg-emerald-700 transition disabled:opacity-50"
                disabled={busy}
                onClick={acceptDeliveryPayment}
                title={t('acceptDeliveryTooltip')}
              >
                {t('acceptDeliveryBtn')}
              </button>
            )}
          {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm(t('confirmCancel')))
                  setStatus('CANCELLED');
              }}
            >
              {t('cancel')}
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
          {o.delivery && o.delivery.status !== 'CANCELLED' && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-3">💬 Chat del domicilio</h3>
              <DeliveryChat
                meRole="BUSINESS"
                primary="#0ea5e9"
                load={() => api<ChatMessage[]>(`/delivery-business/orders/${id}/chat`)}
                send={(body) =>
                  api<ChatMessage[]>(`/delivery-business/orders/${id}/chat`, {
                    method: 'POST',
                    body: JSON.stringify({ body }),
                  })
                }
              />
            </div>
          )}
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">{t('orderItemsTitle')}</h3>
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
                        {t('itemNote', { note: it.note })}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{COP(it.lineTotal)}</div>
                    <div className="text-xs text-mute">{t('unitPriceEach', { price: COP(it.unitPrice) })}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-line mt-3 pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-mute">
                <span>{t('subtotal')}</span>
                <span>{COP(Number(o.subtotal))}</span>
              </div>
              {Number(o.discount) > 0 && (
                <div className="flex justify-between text-ok">
                  <span>{t('discount')}</span>
                  <span>−{COP(Number(o.discount))}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold pt-1 border-t border-line">
                <span>{t('total')}</span>
                <span>{COP(Number(o.total))}</span>
              </div>
            </div>
          </div>

          {o.customerNote && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-2">{t('customerNoteTitle')}</h3>
              <p className="text-sm text-mute italic">"{o.customerNote}"</p>
            </div>
          )}

          {o.rating && (
            <div className="card card-pad">
              <h3 className="font-semibold mb-2">{t('customerRatingTitle')}</h3>
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
            <h3 className="font-semibold mb-3">{t('activityTitle')}</h3>
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
            <h3 className="font-semibold mb-3">{t('customerTitle')}</h3>
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
            <h3 className="font-semibold mb-3">{t('deliveryTitle')}</h3>
            <div className="text-sm">
              {o.fulfillment === 'PICKUP'
                ? t('fulfillmentPickup')
                : o.fulfillment === 'DINE_IN'
                ? t('fulfillmentDineIn', { table: o.tableNumber ?? '' })
                : t('fulfillmentDelivery')}
            </div>
            {o.location && (
              <div className="text-xs text-mute mt-1">
                {o.location.name}
              </div>
            )}
          </div>

          <div className="card card-pad">
            <h3 className="font-semibold mb-3">{t('paymentTitle')}</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-mute">{t('paymentMethod')}</span>
              <span className="font-medium">{o.paymentMethod}</span>
            </div>
            <div className="flex items-center justify-between text-sm mt-1.5">
              <span className="text-mute">{t('paymentStatusLabel')}</span>
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
                {t(PAYMENT_STATUS_LABEL_KEY[o.paymentStatus] ?? 'payStatusPending')}
              </span>
            </div>
            {o.paidAt && (
              <div className="text-xs text-mute mt-2">
                {t('paidOn', { date: fmtDate(o.paidAt) })}
              </div>
            )}
            {o.paymentRef && (
              <div className="text-[11px] text-mute mt-1 truncate">
                {t('refLabel')} <code>{o.paymentRef}</code>
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
                <Icon name="send" /> {t('whatsappReadyTitle')}
              </div>
              <div className="text-xs text-mute mt-1">
                {t('whatsappReadyHint')}
              </div>
            </a>
          )}
        </div>
      </div>
     </div>

     {editing && (
       <EditOrderModal
         order={o}
         onClose={() => setEditing(false)}
         onSaved={async () => {
           setEditing(false);
           await load();
         }}
       />
     )}

     {/* Ticket para imprimir — solo visible en window.print() */}
     <KitchenTicket order={o} />
     <CustomerReceipt order={o} />
    </div>
  );
}

// =====================================================
// Modal de edición de items del pedido (#2 PDF 346)
// Reusa PATCH /orders/:id (updateOrder): el backend re-resuelve precios
// del tenant (anti-tampering) y recalcula subtotal/descuento/total.
// Las líneas existentes preservan su variante/extras; las nuevas se agregan
// como producto base. No editable si el pedido está DELIVERED/CANCELLED.
// =====================================================
type EditLine = {
  key: string;
  productId: string;
  name: string;
  variantId: string | null;
  extraIds: string[];
  extras: { name: string; price: number }[];
  unitPrice: number;
  qty: number;
  note?: string;
};

type ProductPick = {
  id: string;
  name: string;
  basePrice: number;
  isAvailable: boolean;
  variants: { id: string }[];
  extras: { id: string }[];
  category?: { name: string } | null;
};

function EditOrderModal({
  order,
  onClose,
  onSaved,
}: {
  order: Order;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('app_orders_id');
  const [products, setProducts] = useState<ProductPick[]>([]);
  const [lines, setLines] = useState<EditLine[]>(() =>
    order.items.map((it, i) => ({
      key: `orig-${i}`,
      productId: it.productId,
      name: it.name,
      variantId: it.variantId ?? null,
      extraIds: (it.extras ?? [])
        .map((e) => e.id)
        .filter((x): x is string => !!x),
      extras: (it.extras ?? []).map((e) => ({
        name: e.name,
        price: Number(e.price),
      })),
      unitPrice: Number(it.unitPrice),
      qty: it.qty,
      note: it.note,
    })),
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ProductPick[]>('/catalog/products')
      .then((d) => setProducts(d ?? []))
      .catch(() => setProducts([]));
  }, []);

  function setQty(key: string, qty: number) {
    setLines((ls) =>
      ls.map((l) =>
        l.key === key ? { ...l, qty: Math.max(1, Math.min(50, qty)) } : l,
      ),
    );
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }
  function addProduct(p: ProductPick) {
    setLines((ls) => {
      // Si ya hay una línea base (sin variante/extras) de ese producto, suma qty.
      const idx = ls.findIndex(
        (l) => l.productId === p.id && !l.variantId && l.extraIds.length === 0,
      );
      if (idx >= 0) {
        const cp = [...ls];
        cp[idx] = { ...cp[idx], qty: Math.min(50, cp[idx].qty + 1) };
        return cp;
      }
      return [
        ...ls,
        {
          key: `new-${p.id}-${ls.length}`,
          productId: p.id,
          name: p.name,
          variantId: null,
          extraIds: [],
          extras: [],
          unitPrice: Number(p.basePrice),
          qty: 1,
        },
      ];
    });
  }

  // Preserva variante/extras de líneas existentes SOLO si siguen existiendo en
  // el producto (evita 'Variante/Extra inválido' si el dueño los borró después).
  function toPayload(l: EditLine) {
    const p = products.find((x) => x.id === l.productId);
    const variantId =
      l.variantId && p?.variants.some((v) => v.id === l.variantId)
        ? l.variantId
        : undefined;
    const extraIds = p
      ? l.extraIds.filter((eid) => p.extras.some((e) => e.id === eid))
      : [];
    return {
      productId: l.productId,
      variantId,
      extraIds: extraIds.length ? extraIds : undefined,
      qty: l.qty,
      note: l.note || undefined,
    };
  }

  async function save() {
    if (lines.length === 0) {
      toast(t('editEmptyError'), 'error');
      return;
    }
    setSaving(true);
    try {
      await api(`/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ items: lines.map(toPayload) }),
      });
      toast(t('editSaved'), 'success');
      onSaved();
    } catch (e: any) {
      toast(e.message || t('editError'), 'error');
    } finally {
      setSaving(false);
    }
  }

  const itemsSubtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const filtered = products
    .filter((p) => p.isAvailable)
    .filter((p) =>
      search.trim()
        ? p.name.toLowerCase().includes(search.trim().toLowerCase())
        : true,
    )
    .slice(0, 50);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-line2 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-lg">
              {t('editOrderTitle', { code: order.code })}
            </h3>
            <p className="text-xs text-mute mt-0.5">{t('editOrderSubtitle')}</p>
          </div>
          <button
            className="text-mute hover:text-ink text-xl leading-none"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Líneas actuales */}
          <div>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              {t('editCurrentItems')}
            </div>
            {lines.length === 0 ? (
              <div className="text-sm text-mute py-3">{t('editEmptyError')}</div>
            ) : (
              <div className="space-y-2">
                {lines.map((l) => (
                  <div
                    key={l.key}
                    className="flex items-center gap-2 border border-line rounded-lg p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.name}</div>
                      {l.extras.length > 0 && (
                        <div className="text-[11px] text-mute truncate">
                          {l.extras.map((e) => e.name).join(' · ')}
                        </div>
                      )}
                      <div className="text-[11px] text-mute">
                        {COP(l.unitPrice)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-none">
                      <button
                        className="w-7 h-7 rounded-full bg-bg2 hover:bg-line2 font-bold"
                        onClick={() => setQty(l.key, l.qty - 1)}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {l.qty}
                      </span>
                      <button
                        className="w-7 h-7 rounded-full bg-bg2 hover:bg-line2 font-bold"
                        onClick={() => setQty(l.key, l.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="w-20 text-right text-sm font-semibold flex-none">
                      {COP(l.unitPrice * l.qty)}
                    </div>
                    <button
                      className="text-bad-ink hover:opacity-70 text-sm flex-none px-1"
                      title={t('editRemoveLine')}
                      onClick={() => removeLine(l.key)}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar productos */}
          <div>
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              {t('editAddProducts')}
            </div>
            <input
              className="input w-full mb-2"
              placeholder={t('editSearchProducts')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto divide-y divide-line2 border border-line rounded-lg">
              {filtered.length === 0 ? (
                <div className="text-sm text-mute p-3">{t('editNoProducts')}</div>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-2 hover:bg-bg2 flex items-center justify-between gap-2"
                    onClick={() => addProduct(p)}
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">{p.name}</div>
                      {p.category?.name && (
                        <div className="text-[11px] text-mute truncate">
                          {p.category.name}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-none">
                      <span className="text-xs text-mute">
                        {COP(Number(p.basePrice))}
                      </span>
                      <span className="text-brand font-bold text-lg leading-none">
                        ＋
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-line2 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-mute">{t('editItemsSubtotal')}</span>
            <span className="font-bold">{COP(itemsSubtotal)}</span>
          </div>
          <p className="text-[11px] text-mute">{t('editRecalcHint')}</p>
          <button
            className="btn-primary w-full justify-center"
            disabled={saving || lines.length === 0}
            onClick={save}
          >
            {saving ? t('editSaving') : t('editSave')}
          </button>
        </div>
      </div>
    </div>
  );
}

function KitchenTicket({ order }: { order: Order }) {
  const t = useTranslations('app_orders_id');
  const fulfillmentLabel =
    order.fulfillment === 'PICKUP'
      ? t('ticketFulfillmentPickup')
      : order.fulfillment === 'DINE_IN'
      ? t('ticketFulfillmentDineIn', { table: order.tableNumber ?? '?' })
      : t('ticketFulfillmentDelivery');

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
              <strong>{t('ticketCustomerNote')}</strong> {order.customerNote}
            </div>
          </>
        )}

        <div className="ticket-divider" />
        <div className="ticket-total">
          <span>{t('ticketTotal')}</span>
          <span>
            {new Intl.NumberFormat('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0,
            }).format(Number(order.total))}
          </span>
        </div>
        <div className="ticket-foot">
          {order.paymentStatus === 'PAID'
            ? t('ticketFootPaid')
            : t('ticketFootCollectOnDelivery')}
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
  const t = useTranslations('app_orders_id');
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
        title={t('print')}
      >
        🖨 {t('print')} ▾
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
              <div className="font-medium">{t('printKitchenTicket')}</div>
              <div className="text-[11px] text-mute">{t('printKitchenTicketDesc')}</div>
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
              <div className="font-medium">{t('printCustomerReceipt')}</div>
              <div className="text-[11px] text-mute">{t('printCustomerReceiptDesc')}</div>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

function CustomerReceipt({ order }: { order: Order }) {
  const t = useTranslations('app_orders_id');
  return (
    <div className="receipt-only">
      <div className="receipt">
        <div className="receipt-head">
          <div className="receipt-brand">CLUBIFY</div>
          <div className="receipt-code">{t('receiptOrderCode', { code: order.code })}</div>
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
          <div className="receipt-label">{t('receiptCustomer')}</div>
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
          <div className="receipt-label">{t('receiptDetails')}</div>
          <div className="receipt-row">
            <span>{t('receiptType')}</span>
            <span>
              {order.fulfillment === 'PICKUP'
                ? t('receiptPickup')
                : order.fulfillment === 'DINE_IN'
                ? t('receiptDineIn', { table: order.tableNumber ?? '' })
                : t('receiptDelivery')}
            </span>
          </div>
          {order.location && (
            <div className="receipt-row">
              <span>{t('receiptBranch')}</span>
              <span>{order.location.name}</span>
            </div>
          )}
        </div>

        <div className="receipt-items">
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="left">{t('receiptThProduct')}</th>
                <th className="right">{t('receiptThQty')}</th>
                <th className="right">{t('receiptThTotal')}</th>
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
            <span>{t('subtotal')}</span>
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
              <span>{t('discount')}</span>
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
            <span>{t('ticketTotal')}</span>
            <span>
              {new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: 'COP',
                maximumFractionDigits: 0,
              }).format(Number(order.total))}
            </span>
          </div>
          <div className="receipt-row receipt-meta">
            <span>{t('receiptPayStatus')}</span>
            <span>
              {order.paymentStatus === 'PAID'
                ? t('receiptPaid')
                : t('receiptPending')}
            </span>
          </div>
        </div>

        {order.customerNote && (
          <div className="receipt-section">
            <div className="receipt-label">{t('receiptNote')}</div>
            <div>{order.customerNote}</div>
          </div>
        )}

        <div className="receipt-foot">
          {t('receiptFoot')}
        </div>
      </div>
    </div>
  );
}
