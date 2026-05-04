'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
        </div>
      </div>

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
