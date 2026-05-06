'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useBranding, supportWaLink } from '@/lib/useBranding';

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
  { key: 'PENDING' as const, label: 'Nuevos', tone: 'warn' },
  { key: 'CONFIRMED' as const, label: 'Confirmados', tone: 'info' },
  { key: 'READY' as const, label: 'Listos', tone: 'brand' },
  { key: 'DELIVERED' as const, label: 'Entregados', tone: 'ok' },
];

const NEXT: Record<string, Order['status']> = {
  PENDING: 'CONFIRMED',
  CONFIRMED: 'READY',
  READY: 'DELIVERED',
};

const NEXT_LABEL: Record<string, string> = {
  PENDING: 'Confirmar',
  CONFIRMED: 'Marcar listo',
  READY: 'Entregado',
};

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

function timeAgo(d: string) {
  const diff = (Date.now() - new Date(d).getTime()) / 60000;
  if (diff < 1) return 'ahora';
  if (diff < 60) return `${Math.floor(diff)} min`;
  return `${Math.floor(diff / 60)} h`;
}

export default function OrdersBoard() {
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
  const [planName, setPlanName] = useState<string | null>(null);
  const isPro = planName === 'Pro';
  const branding = useBranding();
  const helpLink = supportWaLink(
    branding,
    'Hola, quiero saber más sobre los pedidos online de Clubify',
  );
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
      toast(`🔔 Nuevo pedido #${o.code} de ${o.customer.fullName}`, 'info');
      // Notificación nativa solo si la pestaña no está visible
      if (typeof document !== 'undefined' && document.hidden) {
        browserNotify(
          `Nuevo pedido #${o.code}`,
          `${o.customer.fullName} · ${fmt(Number(o.total))}`,
          `/app/orders/${o.id}`,
        );
      }
    }
  }

  useEffect(() => {
    api<any>('/tenants/me')
      .then((t) => setPlanName(t?.plan?.name ?? null))
      .catch(() => null);
  }, []);

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
    const t = setInterval(load, 30000);
    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('order:upsert', onUpsert);
      clearInterval(t);
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
      toast(e.message || 'No se pudo cambiar el estado', 'error');
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
      toast('Pedido movido', 'success');
    } catch (err: any) {
      toast(err.message || 'No se pudo mover. Refrescando…', 'error');
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
      const t =
        (new Date(o.readyAt!).getTime() - new Date(o.createdAt).getTime()) /
        60000;
      return sum + Math.max(0, t);
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

  // Lockscreen Pro: si el plan está cargado y NO es Pro, bloqueamos toda la página.
  // Mismo patrón que /app/automations.
  if (planName !== null && !isPro) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card card-pad bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white">
          <div className="flex items-start gap-4">
            <div className="text-5xl">🔒</div>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-wider font-bold opacity-80">
                Función exclusiva del plan Pro
              </div>
              <h1 className="text-2xl font-bold mt-1">
                Pedidos en tiempo real
              </h1>
              <p className="text-sm text-white/90 mt-2 leading-relaxed">
                Recibe pedidos del menú online en un tablero kanban, con sonido
                de alerta, vista cocina para TV, control de pago, y todo el
                flujo desde "Nuevo" hasta "Entregado". Tus clientes piden
                directo desde tu sitio sin apps de terceros.
              </p>
              <div className="mt-3 text-sm text-white/85">
                Tu plan actual: <b>{planName}</b> · Necesitas:{' '}
                <b className="text-white">Pro</b> (USD 99/mes)
              </div>
            </div>
          </div>
          <div className="mt-5 flex gap-2 flex-wrap">
            <Link
              href="/app/billing"
              className="bg-white text-brand-700 font-semibold px-5 py-2.5 rounded-pill text-sm hover:bg-white/95"
            >
              Activar plan Pro →
            </Link>
            {helpLink && (
            <a
              href={helpLink}
              target="_blank"
              rel="noreferrer"
              className="bg-white/15 hover:bg-white/25 transition border border-white/30 text-white font-semibold px-5 py-2.5 rounded-pill text-sm"
            >
              💬 Tengo dudas
            </a>
            )}
          </div>
        </div>

        <div className="card card-pad mt-4">
          <h3 className="text-base font-semibold m-0">Qué desbloqueas</h3>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2.5 text-sm">
            {[
              '🛒 Pedidos online desde tu menú público',
              '📋 Tablero kanban (Nuevo → Confirmado → Listo → Entregado)',
              '🔔 Sonido de alerta + notificación nativa al recibir',
              '🍳 Vista cocina full screen para TV',
              '💳 Control de pago (cobrado / por cobrar)',
              '⏱ Métricas de tiempo de preparación',
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-center text-xs text-mute mt-6">
          ¿Ya pagaste y aún ves esto? Refresca la página o escríbenos.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Pedidos{' '}
          <span className="page-crumb">
            / {counts.PENDING + counts.CONFIRMED + counts.READY} en curso
          </span>
        </h1>
        <div className="flex items-center gap-2 -mt-1 mb-2 lg:mb-0 lg:mt-0">
          {opStats.avgMin !== null && (
            <span
              className="inline-flex items-center gap-1.5 text-xs bg-bg2/70 border border-line rounded-pill px-3 py-1"
              title="Tiempo promedio desde creado hasta listo"
            >
              ⏱ <b className="text-ink">{opStats.avgMin}m</b>{' '}
              <span className="text-mute">prep promedio</span>
            </span>
          )}
          {opStats.lateCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-pill px-3 py-1"
              title="Pedidos en curso de más de 15 min"
            >
              🔴 <b>{opStats.lateCount}</b> tarde
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-line rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              className="border-0 outline-none text-sm w-44 bg-transparent"
              placeholder="Buscar #código, nombre, tel…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button
                onClick={() => setSearchQ('')}
                className="text-mute hover:text-ink text-sm"
                title="Limpiar"
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
                  d === 1 ? 'Solo hoy' : d === 7 ? 'Última semana' : 'Último mes'
                }
              >
                {d === 1 ? 'Hoy' : `${d}d`}
              </button>
            ))}
          </div>
          <span
            className={`badge ${live ? 'badge-ok' : 'badge-mute'} text-[11px]`}
            title={live ? 'Conectado en tiempo real' : 'Sin conexión live'}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block mr-1.5"
              style={{ background: live ? '#16A34A' : '#9CA3AF' }}
            />
            {live ? 'En vivo' : 'Sin conexión'}
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
            title={soundOn ? 'Silenciar alertas de pedidos' : 'Activar alertas de pedidos'}
          >
            {soundOn ? '🔔 Sonido ON' : '🔕 Sonido OFF'}
          </button>
          <Link
            href="/app/orders/display"
            className="btn-ghost text-xs"
            title="Vista TV cocina (full screen)"
          >
            🍳 Modo cocina
          </Link>
          <button className="btn-ghost" onClick={load}>
            <Icon name="history" /> Refrescar
          </button>
          <button
            className="btn-ghost text-xs"
            title="Descargar CSV"
            onClick={() =>
              downloadFile(
                '/orders/export.csv',
                `pedidos-${new Date().toISOString().slice(0, 10)}.csv`,
              )
            }
          >
            ⤓ CSV
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => setNewOrderOpen(true)}
            title="Crear pedido manual (walk-in, teléfono, etc.)"
          >
            <Icon name="plus" /> Nuevo pedido
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
                {col.label}{' '}
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
                    ? 'Suelta aquí'
                    : searchQ
                    ? 'Sin coincidencias'
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
                    <span>{timeAgo(o.createdAt)}</span>
                  </div>
                  <Link
                    href={`/app/orders/${o.id}`}
                    className="font-semibold text-sm mt-0.5 block hover:text-brand"
                  >
                    {o.customer.fullName}
                  </Link>
                  <div className="text-xs text-mute">{o.customer.phone}</div>
                  <div className="text-xs text-mute mt-1">
                    {o.items.length} items · {fmt(Number(o.total))}
                  </div>
                  <div className="text-xs text-mute mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>
                      {o.fulfillment === 'PICKUP'
                        ? '🥡 Para llevar'
                        : o.fulfillment === 'DINE_IN'
                        ? `🍽 Mesa ${o.tableNumber ?? ''}`
                        : '🛵 Domicilio'}
                    </span>
                    {o.paymentStatus === 'PAID' && (
                      <span className="badge badge-ok text-[10px]">💳 Pagado</span>
                    )}
                    {o.paymentStatus === 'PENDING' && (
                      <span className="badge badge-warn text-[10px]">⏳ Pago pend.</span>
                    )}
                    {o.paymentStatus === 'FAILED' && (
                      <span className="badge text-[10px] bg-bad-soft text-bad-ink">
                        ✕ Pago fall.
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
                        {NEXT_LABEL[o.status]}
                      </button>
                    )}
                    {o.whatsappLink && (
                      <a
                        href={o.whatsappLink}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost text-xs px-3 py-1.5"
                      >
                        WA dueño
                      </a>
                    )}
                    {o.status !== 'CANCELLED' && o.status !== 'DELIVERED' && (
                      <button
                        disabled={busy === o.id}
                        onClick={() => setStatus(o.id, 'CANCELLED')}
                        className="btn-danger text-xs px-3 py-1.5"
                      >
                        Cancelar
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
  label: string;
  hint: string;
}> = [
  { value: 'PENDING', label: 'Pendiente', hint: 'Aún por confirmar' },
  { value: 'CONFIRMED', label: 'Confirmado', hint: 'En cocina' },
  { value: 'READY', label: 'Listo', hint: 'Esperando entregar' },
  { value: 'DELIVERED', label: 'Entregado', hint: 'Walk-in / cobro en caja' },
];

function NewOrderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (orderId: string) => void;
}) {
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
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Cargar productos disponibles una sola vez
  useEffect(() => {
    api<ProductLite[]>('/products')
      .then((all) => setProducts(all.filter((p) => p.isAvailable)))
      .catch(() => setProducts([]));
  }, []);

  // Búsqueda live de clientes (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
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
    return () => clearTimeout(t);
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

  const total = useMemo(
    () => cart.reduce((acc, c) => acc + c.unitPrice * c.qty, 0),
    [cart],
  );

  async function submit() {
    if (!pickedCustomer) {
      setErr('Selecciona un cliente');
      return;
    }
    if (cart.length === 0) {
      setErr('Agrega al menos un producto');
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
          paymentMethod: paymentStatus === 'PAID' ? 'CASH' : 'CASH_ON_DELIVERY',
          fulfillment: tableNumber.trim() ? 'DINE_IN' : 'PICKUP',
          tableNumber: tableNumber.trim() || undefined,
          customerNote: customerNote.trim() || undefined,
        }),
      });
      toast('Pedido creado', 'success');
      onCreated(order.id);
    } catch (e: any) {
      setErr(e.message || 'No se pudo crear el pedido');
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
            <div className="font-semibold text-lg">Nuevo pedido</div>
            <div className="text-xs text-mute">
              Walk-in, teléfono o cualquier pedido fuera del menú público
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
            <label className="label">Cliente</label>
            {pickedCustomer ? (
              <div className="flex items-center gap-3 bg-brand-soft border border-brand/20 rounded-input px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {pickedCustomer.fullName}
                  </div>
                  <div className="text-xs text-mute truncate">
                    {pickedCustomer.phone || pickedCustomer.email || 'Sin contacto'}
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
                  Cambiar
                </button>
              </div>
            ) : (
              <>
                <input
                  className="input"
                  placeholder="Buscar por nombre, teléfono o email…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  autoFocus
                />
                {customerSearch.trim().length >= 2 && (
                  <div className="border border-line rounded-input mt-1 max-h-48 overflow-y-auto bg-white">
                    {customers.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-mute text-center">
                        Sin resultados.{' '}
                        <Link
                          href="/app/customers"
                          target="_blank"
                          className="text-brand hover:underline"
                        >
                          Crear cliente nuevo →
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
                            {c.phone || c.email || 'Sin contacto'}
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
            <label className="label">Productos</label>
            <input
              className="input mb-2"
              placeholder="Buscar producto o categoría…"
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
                  Sin productos para mostrar.
                </div>
              )}
            </div>
          </div>

          {/* Carrito */}
          {cart.length > 0 && (
            <div className="border border-line rounded-input p-3 bg-bg2/30">
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                Carrito ({cart.length} líneas)
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
                <span>Total</span>
                <span>{fmt(total)}</span>
              </div>
            </div>
          )}

          {/* Opciones */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Estado inicial</label>
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
                    title={s.hint}
                  >
                    {s.label}
                    <div
                      className={`text-[10px] font-normal mt-0.5 ${
                        status === s.value ? 'text-white/80' : 'text-mute'
                      }`}
                    >
                      {s.hint}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Pago</label>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { v: 'PAID', l: '✓ Cobrado' },
                    { v: 'PENDING', l: 'Por cobrar' },
                    { v: 'NOT_REQUIRED', l: 'No aplica' },
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
                    {p.l}
                  </button>
                ))}
              </div>
              <label className="label mt-3">Mesa (opcional)</label>
              <input
                className="input"
                placeholder="Ej: 5"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Nota interna (opcional)</label>
            <input
              className="input"
              placeholder="Ej: sin azúcar, para llevar…"
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
            {cart.length > 0 ? `Total: ${fmt(total)}` : 'Carrito vacío'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-ghost text-sm"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={
                submitting || !pickedCustomer || cart.length === 0
              }
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? 'Creando…' : 'Crear pedido →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
