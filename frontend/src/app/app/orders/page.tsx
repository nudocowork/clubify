'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, downloadFile } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { getOrdersSocket } from '@/lib/socket';
import { toast } from '@/components/Toast';
import {
  playOrderBeep,
  browserNotify,
  ensureNotificationPermission,
} from '@/lib/notify';

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  total: number;
  fulfillment: 'PICKUP' | 'DINE_IN' | 'DELIVERY';
  tableNumber: string | null;
  customer: { fullName: string; phone: string };
  items: any[];
  createdAt: string;
  confirmedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  whatsappLink?: string;
  paymentStatus?:
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'PAID'
    | 'FAILED'
    | 'REFUNDED';
  paymentMethod?: string;
};

const COLS = [
  { key: 'PENDING' as const, labelKey: 'colPending', tone: 'warn' },
  { key: 'CONFIRMED' as const, labelKey: 'colConfirmed', tone: 'info' },
  { key: 'READY' as const, labelKey: 'colReady', tone: 'brand' },
  { key: 'DELIVERED' as const, labelKey: 'colDelivered', tone: 'ok' },
];

const NEXT: Record<string, Order['status']> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'READY',
  READY: 'DELIVERED',
};

const NEXT_LABEL_KEY: Record<string, string> = {
  PENDING: 'nextConfirm',
  CONFIRMED: 'nextMarkReady',
  READY: 'nextDelivered',
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

function timeAgo(d: string, t: (key: string, values?: Record<string, any>) => string) {
  const diff = (Date.now() - new Date(d).getTime()) / 60000;
  if (diff < 1) return t('timeNow');
  if (diff < 60) return t('timeMinutes', { min: Math.floor(diff) });
  return t('timeHours', { h: Math.floor(diff / 60) });
}

export default function OrdersBoard() {
  const t = useTranslations('app_orders');
  const [board, setBoard] = useState<Record<string, Order[]>>({
    PENDING: [],
    CONFIRMED: [],
    READY: [],
    DELIVERED: [],
    CANCELLED: [],
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [scopeDays, setScopeDays] = useState<1 | 7 | 30>(1);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const router = useRouter();
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const seenRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(board);
  stateRef.current = board;

  async function load() {
    try {
      const data = await api<typeof board>(`/orders/board?days=${scopeDays}`);
      // Hidratamos el set de IDs vistos en la primera carga sin alertar.
      const allIds = new Set<string>();
      for (const k of Object.keys(data)) {
        for (const o of data[k] ?? []) allIds.add(o.id);
      }
      if (seenRef.current.size === 0) {
        seenRef.current = allIds;
      } else {
        for (const id of allIds) seenRef.current.add(id);
      }
      setBoard(data);
    } catch {}
  }

  function applyUpsert(o: Order) {
    const cur = stateRef.current;
    const isNew = !seenRef.current.has(o.id);
    seenRef.current.add(o.id);

    const next: Record<string, Order[]> = {
      PENDING: [],
      CONFIRMED: [],
      READY: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    for (const k of Object.keys(cur)) {
      next[k] = (cur[k] ?? []).filter((x) => x.id !== o.id);
    }
    next[o.status] = [o, ...(next[o.status] ?? [])];
    setBoard(next);

    // Alerta solo para pedidos NUEVOS recién creados (PENDING)
    if (isNew && o.status === 'PENDING') {
      if (soundRef.current) playOrderBeep();
      setFlashId(o.id);
      setTimeout(() => {
        setFlashId((cur) => (cur === o.id ? null : cur));
      }, 4000);
      toast(t('toastNewOrder', { code: o.code, name: o.customer.fullName }), 'info');
      // Notificación nativa solo si la pestaña no está visible
      if (typeof document !== 'undefined' && document.hidden) {
        browserNotify(
          t('notifyNewOrder', { code: o.code }),
          `${o.customer.fullName} · ${fmt(Number(o.total))}`,
          `/app/orders/${o.id}`,
        );
      }
    }
  }

  useEffect(() => {
    try {
      const v = localStorage.getItem('clubify:orders:sound');
      if (v === '0') setSoundOn(false);
    } catch {}
    const sock = getOrdersSocket();
    function onConnect() {
      setLive(true);
    }
    function onDisconnect() {
      setLive(false);
    }
    function onUpsert(o: Order) {
      applyUpsert(o);
    }
    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('order:upsert', onUpsert);
    if (sock.connected) onConnect();

    // Fallback: recarga cada 30s en caso de desconexión silenciosa
    const interval = setInterval(load, 30000);
    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('order:upsert', onUpsert);
      clearInterval(interval);
    };
  }, []);

  // Recarga cuando cambia el scope de fechas (no incluido en el efecto de socket).
  useEffect(() => {
    seenRef.current = new Set(); // re-hidratar IDs en el siguiente load
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeDays]);

  async function setStatus(id: string, status: Order['status']) {
    setBusy(id);
    try {
      await api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e: any) {
      toast(e.message || t('errorChangeStatus'), 'error');
    } finally {
      setBusy(null);
    }
  }

  // ====== Drag & drop ======
  const [dragOver, setDragOver] = useState<string | null>(null);

  function onCardDragStart(
    e: React.DragEvent<HTMLDivElement>,
    order: Order,
  ) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(
      'application/x-clubify-order',
      JSON.stringify({ id: order.id, from: order.status }),
    );
  }

  function onColDragOver(
    e: React.DragEvent<HTMLDivElement>,
    colKey: string,
  ) {
    if (!e.dataTransfer.types.includes('application/x-clubify-order')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== colKey) setDragOver(colKey);
  }

  function onColDragLeave(colKey: string) {
    setDragOver((cur) => (cur === colKey ? null : cur));
  }

  async function onColDrop(
    e: React.DragEvent<HTMLDivElement>,
    target: Order['status'],
  ) {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData('application/x-clubify-order');
    if (!raw) return;
    const { id, from } = JSON.parse(raw) as {
      id: string;
      from: Order['status'];
    };
    if (from === target) return;

    // Optimistic move
    setBoard((prev) => {
      const fromList = (prev[from] ?? []).filter((o) => o.id !== id);
      const moved = (prev[from] ?? []).find((o) => o.id === id);
      if (!moved) return prev;
      const updated: Order = { ...moved, status: target };
      return {
        ...prev,
        [from]: fromList,
        [target]: [updated, ...(prev[target] ?? [])],
      };
    });

    try {
      await api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target }),
      });
      toast(t('toastOrderMoved'), 'success');
    } catch (err: any) {
      toast(err.message || t('errorCouldNotMove'), 'error');
      load();
    }
  }

  // Aplicamos filtro de búsqueda al board completo (client-side)
  const filteredBoard = useMemo(() => {
    const term = searchQ.trim().toLowerCase();
    if (!term) return board;
    const out: typeof board = {
      PENDING: [],
      CONFIRMED: [],
      READY: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    for (const k of Object.keys(board)) {
      out[k] = (board[k] ?? []).filter((o) => {
        const hay = `${o.code} ${o.customer?.fullName ?? ''} ${o.customer?.phone ?? ''}`.toLowerCase();
        return hay.includes(term);
      });
    }
    return out;
  }, [board, searchQ]);

  const counts = Object.fromEntries(
    Object.entries(filteredBoard).map(([k, v]) => [k, (v as Order[]).length]),
  );

  // KPIs operativos: tiempo medio createdAt → readyAt sobre los últimos pedidos completados.
  const opStats = useMemo(() => {
    const all = [
      ...(filteredBoard.READY ?? []),
      ...(filteredBoard.DELIVERED ?? []),
    ];
    const withReady = all.filter((o) => !!o.readyAt);
    if (withReady.length === 0) return { avgMin: null, lateCount: 0 };
    const totalMin = withReady.reduce((sum, o) => {
      const elapsed =
        (new Date(o.readyAt!).getTime() - new Date(o.createdAt).getTime()) /
        60000;
      return sum + Math.max(0, elapsed);
    }, 0);
    const avgMin = Math.round(totalMin / withReady.length);

    // Cuántos pedidos en curso ya pasaron > 15min sin estar listos
    const lateCount = [
      ...(filteredBoard.PENDING ?? []),
      ...(filteredBoard.CONFIRMED ?? []),
    ].filter(
      (o) =>
        (Date.now() - new Date(o.createdAt).getTime()) / 60000 > 15,
    ).length;

    return { avgMin, lateCount };
  }, [filteredBoard]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          <span className="page-crumb">
            {t('crumbInProgress', { count: counts.PENDING + counts.CONFIRMED + counts.READY })}
          </span>
        </h1>
        <div className="flex items-center gap-2 -mt-1 mb-2 lg:mb-0 lg:mt-0">
          {opStats.avgMin !== null && (
            <span
              className="inline-flex items-center gap-1.5 text-xs bg-bg2/70 border border-line rounded-pill px-3 py-1"
              title={t('avgPrepTooltip')}
            >
              ⏱ <b className="text-ink">{t('avgPrepMinutes', { min: opStats.avgMin })}</b>{' '}
              <span className="text-mute">{t('avgPrepLabel')}</span>
            </span>
          )}
          {opStats.lateCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-pill px-3 py-1"
              title={t('lateTooltip')}
            >
              🔴 <b>{opStats.lateCount}</b> {t('lateLabel')}
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-44 bg-transparent"
              placeholder={t('searchPlaceholder')}
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button
                onClick={() => setSearchQ('')}
                className="text-mute hover:text-ink text-sm"
                title={t('clear')}
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex gap-0.5 bg-bg2 rounded-pill p-0.5 text-xs">
            {([1, 7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setScopeDays(d)}
                className={`px-3 py-1 rounded-pill font-medium ${
                  scopeDays === d
                    ? 'bg-white text-ink shadow-sm'
                    : 'text-mute hover:text-ink'
                }`}
                title={
                  d === 1 ? t('scopeTodayTooltip') : d === 7 ? t('scopeWeekTooltip') : t('scopeMonthTooltip')
                }
              >
                {d === 1 ? t('scopeToday') : t('scopeDays', { days: d })}
              </button>
            ))}
          </div>
          <span
            className={`badge ${live ? 'badge-ok' : 'badge-mute'} text-[11px]`}
            title={live ? t('liveTooltip') : t('offlineTooltip')}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block mr-1.5"
              style={{ background: live ? '#16A34A' : '#9CA3AF' }}
            />
            {live ? t('live') : t('offline')}
          </span>
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              try {
                localStorage.setItem('clubify:orders:sound', next ? '1' : '0');
              } catch {}
              if (next) {
                ensureNotificationPermission();
                playOrderBeep(); // tono de prueba al activar
              }
            }}
            className={`text-xs px-3 py-1.5 rounded-pill border ${
              soundOn
                ? 'bg-brand-soft text-brand-700 border-brand/30'
                : 'bg-bg2 text-mute border-line'
            }`}
            title={soundOn ? t('soundOnTooltip') : t('soundOffTooltip')}
          >
            {soundOn ? t('soundOn') : t('soundOff')}
          </button>
          <Link
            href="/app/orders/display"
            className="btn-ghost text-xs"
            title={t('kitchenModeTooltip')}
          >
            🍳 {t('kitchenMode')}
          </Link>
          <button className="btn-ghost" onClick={load}>
            <Icon name="history" /> {t('refresh')}
          </button>
          <button
            className="btn-ghost text-xs"
            title={t('downloadCsvTooltip')}
            onClick={() =>
              downloadFile(
                '/orders/export.csv',
                `pedidos-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            ⤓ {t('csv')}
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => setNewOrderOpen(true)}
            title={t('newOrderTooltip')}
          >
            <Icon name="plus" /> {t('newOrder')}
          </button>
        </div>
      </div>

      {newOrderOpen && (
        <NewOrderModal
          onClose={() => setNewOrderOpen(false)}
          onCreated={(orderId) => {
            setNewOrderOpen(false);
            load();
            router.push(`/app/orders/${orderId}`);
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLS.map((col) => (
          <div
            key={col.key}
            className={`card transition ${
              dragOver === col.key ? 'ring-2 ring-brand ring-offset-2' : ''
            }`}
            onDragOver={(e) => onColDragOver(e, col.key)}
            onDragLeave={() => onColDragLeave(col.key)}
            onDrop={(e) => onColDrop(e, col.key)}
          >
            <div className="card-h">
              <h3>
                {t(col.labelKey)}{' '}
                <span className="text-mute font-normal">({counts[col.key] ?? 0})</span>
              </h3>
              <span
                className={`badge ${
                  col.tone === 'warn'
                    ? 'badge-warn'
                    : col.tone === 'info'
                    ? 'badge-info'
                    : col.tone === 'brand'
                    ? 'badge-info'
                    : 'badge-ok'
                }`}
              >
                {col.tone === 'warn' ? '🔔' : '•'}
              </span>
            </div>
            <div className="p-3 space-y-2.5 min-h-[120px] max-h-[70vh] overflow-auto">
              {filteredBoard[col.key]?.length === 0 && (
                <div
                  className={`text-sm text-center py-6 rounded-lg border border-dashed ${
                    dragOver === col.key
                      ? 'border-brand text-brand bg-brand-soft'
                      : 'border-line text-mute'
                  }`}
                >
                  {dragOver === col.key
                    ? t('dropHere')
                    : searchQ
                    ? t('noMatches')
                    : '—'}
                </div>
              )}
              {filteredBoard[col.key]?.map((o) => (
                <div
                  key={o.id}
                  draggable
                  onDragStart={(e) => onCardDragStart(e, o)}
                  className={`border rounded-lg p-3 transition cursor-grab active:cursor-grabbing ${
                    flashId === o.id
                      ? 'border-brand bg-brand-soft ring-2 ring-brand/40 animate-pulse-once'
                      : 'border-line2 bg-bg2/30 hover:bg-bg2'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-mute">
                    <Link href={`/app/orders/${o.id}`} className="hover:text-brand">
                      #{o.code} →
                    </Link>
                    <span>{timeAgo(o.createdAt, t)}</span>
                  </div>
                  <Link
                    href={`/app/orders/${o.id}`}
                    className="font-semibold text-sm mt-0.5 block hover:text-brand"
                  >
                    {o.customer.fullName}
                  </Link>
                  <div className="text-xs text-mute">{o.customer.phone}</div>
                  <div className="text-xs text-mute mt-1">
                    {t('itemsCount', { count: o.items.length })} · {fmt(Number(o.total))}
                  </div>
                  <div className="text-xs text-mute mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>
                      {o.fulfillment === 'PICKUP'
                        ? `🥡 ${t('fulfillmentPickup')}`
                        : o.fulfillment === 'DINE_IN'
                        ? `🍽 ${t('fulfillmentDineIn', { table: o.tableNumber ?? '' })}`
                        : `🛵 ${t('fulfillmentDelivery')}`}
                    </span>
                    {o.paymentStatus === 'PAID' && (
                      <span className="badge badge-ok text-[10px]">💳 {t('paymentPaid')}</span>
                    )}
                    {o.paymentStatus === 'PENDING' && (
                      <span className="badge badge-warn text-[10px]">⏳ {t('paymentPending')}</span>
                    )}
                    {o.paymentStatus === 'FAILED' && (
                      <span className="badge text-[10px] bg-bad-soft text-bad-ink">
                        ✕ {t('paymentFailed')}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {NEXT[o.status] && (
                      <button
                        disabled={busy === o.id}
                        onClick={() => setStatus(o.id, NEXT[o.status])}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {t(NEXT_LABEL_KEY[o.status])}
                      </button>
                    )}
                    {o.whatsappLink && (
                      <a
                        href={o.whatsappLink}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost text-xs px-3 py-1.5"
                      >
                        {t('waOwner')}
                      </a>
                    )}
                    {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
                      <button
                        disabled={busy === o.id}
                        onClick={() => setStatus(o.id, 'CANCELLED')}
                        className="btn-danger text-xs px-3 py-1.5"
                      >
                        {t('cancel')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
//                 NEW MANUAL ORDER MODAL
// ============================================================

type CustomerLite = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
};

type ProductLite = {
  id: string;
  name: string;
  basePrice: number;
  isAvailable: boolean;
  category?: { name: string } | null;
};

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

const STATUS_OPTIONS: Array<{
  value: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED';
  labelKey: string;
  hintKey: string;
}> = [
  { value: 'PENDING', labelKey: 'statusPending', hintKey: 'statusPendingHint' },
  { value: 'CONFIRMED', labelKey: 'statusConfirmed', hintKey: 'statusConfirmedHint' },
  { value: 'READY', labelKey: 'statusReady', hintKey: 'statusReadyHint' },
  { value: 'DELIVERED', labelKey: 'statusDelivered', hintKey: 'statusDeliveredHint' },
];

function NewOrderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
  const t = useTranslations('app_orders');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [pickedCustomer, setPickedCustomer] = useState<CustomerLite | null>(
    null,
  );
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [status, setStatus] = useState<
    'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED'
  >('CONFIRMED');
  const [paymentStatus, setPaymentStatus] = useState<
    'NOT_REQUIRED' | 'PAID' | 'PENDING'
  >('PAID');
  const [tableNumber, setTableNumber] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  // Monto de delivery: input numérico simple. Vacío = no aplica.
  // El total se recalcula client-side para preview; backend valida.
  const [deliveryAmount, setDeliveryAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Cargar productos disponibles una sola vez.
  // FIX: el endpoint vive en /catalog/products, no /products — el path
  // viejo daba 404 silencioso y el modal mostraba "Sin productos para
  // mostrar" en cualquier tenant.
  useEffect(() => {
    api<ProductLite[]>('/catalog/products')
      .then((all) => setProducts(all.filter((p) => p.isAvailable)))
      .catch(() => setProducts([]));
  }, []);

  // Búsqueda live de clientes (debounced)
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (customerSearch.trim().length < 2) {
        setCustomers([]);
        return;
      }
      try {
        const list: CustomerLite[] = await api(
          `/customers?search=${encodeURIComponent(customerSearch)}`,
        );
        setCustomers(list.slice(0, 8));
      } catch {
        setCustomers([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 30);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category?.name?.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [productSearch, products]);

  function addToCart(p: ProductLite) {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.productId === p.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unitPrice: Number(p.basePrice),
          qty: 1,
        },
      ];
    });
  }

  function setQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.productId !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((c) =>
        c.productId === productId ? { ...c, qty: Math.min(50, qty) } : c,
      ),
    );
  }

  const subtotal = useMemo(
    () => cart.reduce((acc, c) => acc + c.unitPrice * c.qty, 0),
    [cart],
  );
  const deliveryNumber = useMemo(() => {
    const n = parseFloat(deliveryAmount.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [deliveryAmount]);
  const total = subtotal + deliveryNumber;

  async function submit() {
    if (!pickedCustomer) {
      setErr(t('errorSelectCustomer'));
      return;
    }
    if (cart.length === 0) {
      setErr(t('errorAddProduct'));
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const order = await api<{ id: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerId: pickedCustomer.id,
          items: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
          status,
          paymentStatus,
          // Fix 2026-06-10: el enum Prisma `PaymentMethod` solo acepta
          // CASH_ON_DELIVERY | STUB | STRIPE | MERCADO_PAGO | WOMPI | PSE.
          // El panel mandaba 'CASH' para pagos cobrados al momento →
          // Prisma rechazaba con 500. Usamos CASH_ON_DELIVERY como
          // método universal de efectivo (cubre walk-in cobrado en caja
          // Y "pagar al recibir"); `paidAt` distingue ambos en reportes.
          paymentMethod: 'CASH_ON_DELIVERY',
          fulfillment: tableNumber.trim() ? 'DINE_IN' : 'PICKUP',
          tableNumber: tableNumber.trim() || undefined,
          customerNote: customerNote.trim() || undefined,
          deliveryAmount: deliveryNumber > 0 ? deliveryNumber : undefined,
        }),
      });
      toast(t('toastOrderCreated'), 'success');
      onCreated(order.id);
    } catch (e: any) {
      setErr(e.message || t('errorCouldNotCreate'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <div className="font-semibold text-lg">{t('newOrder')}</div>
            <div className="text-xs text-mute">
              {t('newOrderSubtitle')}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Cliente */}
          <div>
            <label className="label">{t('customer')}</label>
            {pickedCustomer ? (
              <div className="flex items-center gap-3 bg-brand-soft border border-brand/20 rounded-input px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {pickedCustomer.fullName}
                  </div>
                  <div className="text-xs text-mute truncate">
                    {pickedCustomer.phone || pickedCustomer.email || t('noContact')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPickedCustomer(null);
                    setCustomerSearch('');
                  }}
                  className="text-xs text-mute hover:text-ink"
                >
                  {t('change')}
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder={t('customerSearchPlaceholder')}
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  autoFocus
                />
                {customerSearch.trim().length >= 2 && (
                  <div className="border border-line rounded-input mt-1 max-h-48 overflow-y-auto bg-white">
                    {customers.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-mute text-center">
                        {t('noResults')}{' '}
                        <Link
                          href="/app/customers"
                          target="_blank"
                          className="text-brand hover:underline"
                        >
                          {t('createNewCustomer')} →
                        </Link>
                      </div>
                    ) : (
                      customers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setPickedCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-bg2/40 border-b border-line2 last:border-b-0"
                        >
                          <div className="text-sm font-medium">{c.fullName}</div>
                          <div className="text-xs text-mute">
                            {c.phone || c.email || t('noContact')}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Productos */}
          <div>
            <label className="label">{t('products')}</label>
            <input
              className="input mb-2"
              placeholder={t('productSearchPlaceholder')}
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto">
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  className="text-left border border-line2 rounded-input px-2.5 py-2 hover:border-brand/50 hover:bg-brand-soft transition"
                >
                  <div className="text-xs font-semibold truncate">{p.name}</div>
                  <div className="text-[11px] text-mute mt-0.5">
                    {fmt(Number(p.basePrice))}
                  </div>
                </button>
              ))}
              {filteredProducts.length === 0 && (
                <div className="col-span-full text-sm text-mute text-center py-4">
                  {t('noProducts')}
                </div>
              )}
            </div>
          </div>

          {/* Carrito */}
          {cart.length > 0 && (
            <div className="border border-line rounded-input p-3 bg-bg2/30">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('cartLines', { count: cart.length })}
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {cart.map((c) => (
                  <div
                    key={c.productId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <div className="flex-1 truncate">{c.name}</div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQty(c.productId, c.qty - 1)}
                        className="w-6 h-6 rounded-full bg-bg2 hover:bg-line text-ink"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-medium">{c.qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(c.productId, c.qty + 1)}
                        className="w-6 h-6 rounded-full bg-bg2 hover:bg-line text-ink"
                      >
                        +
                      </button>
                    </div>
                    <div className="w-20 text-right text-mute text-xs">
                      {fmt(c.unitPrice * c.qty)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-line2 mt-2 pt-2 flex justify-between font-semibold">
                <span>{t('total')}</span>
                <span>{fmt(total)}</span>
              </div>
            </div>
          )}

          {/* Opciones */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('initialStatus')}</label>
              <div className="grid grid-cols-2 gap-1">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    type="button"
                    key={s.value}
                    onClick={() => setStatus(s.value)}
                    className={`px-2 py-2 rounded-input text-xs font-semibold transition text-left ${
                      status === s.value
                        ? 'bg-brand text-white'
                        : 'bg-bg2 text-ink hover:bg-line'
                    }`}
                    title={t(s.hintKey)}
                  >
                    {t(s.labelKey)}
                    <div
                      className={`text-[10px] font-normal mt-0.5 ${
                        status === s.value ? 'text-white/80' : 'text-mute'
                      }`}
                    >
                      {t(s.hintKey)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t('payment')}</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { v: 'PAID', labelKey: 'payPaid' },
                    { v: 'PENDING', labelKey: 'payPending' },
                    { v: 'NOT_REQUIRED', labelKey: 'payNotRequired' },
                  ] as const
                ).map((p) => (
                  <button
                    type="button"
                    key={p.v}
                    onClick={() => setPaymentStatus(p.v)}
                    className={`px-2 py-2 rounded-input text-xs font-semibold transition ${
                      paymentStatus === p.v
                        ? 'bg-ok text-white'
                        : 'bg-bg2 text-ink hover:bg-line'
                    }`}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
              <label className="label mt-3">{t('tableOptional')}</label>
              <input
                className="input"
                placeholder={t('tablePlaceholder')}
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
              />
            </div>
          </div>

          {/* Monto de delivery — opcional, se suma al total si > 0. */}
          <div>
            <label className="label">
              {t('deliveryAmount')}{' '}
              <span className="text-mute font-normal">
                {t('deliveryAmountNote')}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1"
                type="number"
                min="0"
                step="0.01"
                placeholder={t('deliveryAmountPlaceholder')}
                value={deliveryAmount}
                onChange={(e) => setDeliveryAmount(e.target.value)}
              />
              {deliveryAmount && deliveryNumber > 0 && (
                <button
                  type="button"
                  onClick={() => setDeliveryAmount('')}
                  className="text-xs text-mute hover:text-ink"
                >
                  {t('remove')}
                </button>
              )}
            </div>
            {deliveryNumber > 0 && (
              <div className="text-xs text-mute mt-1">
                {t('deliveryBreakdown', { subtotal: fmt(subtotal), delivery: fmt(deliveryNumber) })}{' '}
                <strong className="text-ink">{fmt(total)}</strong>
              </div>
            )}
          </div>

          <div>
            <label className="label">{t('internalNote')}</label>
            <input
              className="input"
              placeholder={t('internalNotePlaceholder')}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
            />
          </div>

          {err && (
            <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
              {err}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line bg-bg2/30 flex items-center justify-between gap-3">
          <div className="text-sm text-mute">
            {cart.length > 0 ? t('totalAmount', { amount: fmt(total) }) : t('emptyCart')}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-ghost text-sm"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={
                submitting || !pickedCustomer || cart.length === 0
              }
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? t('creating') : t('createOrderCta')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
