'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, downloadFile } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { getOrdersSocket } from '@/lib/socket';

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
  const stateRef = useRef(board);
  stateRef.current = board;

  async function load() {
    try {
      const data = await api<typeof board>('/orders/board');
      setBoard(data);
    } catch {}
  }

  function applyUpsert(o: Order) {
    const cur = stateRef.current;
    // Si cambió de columna o se agregó, recolocar
    const next: Record<string, Order[]> = {
      PENDING: [],
      CONFIRMED: [],
      READY: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    let placed = false;
    for (const k of Object.keys(cur)) {
      next[k] = (cur[k] ?? []).filter((x) => {
        if (x.id !== o.id) return true;
        return false;
      });
    }
    next[o.status] = [o, ...(next[o.status] ?? [])];
    placed = true;
    if (!placed) next[o.status].push(o);
    setBoard(next);
  }

  useEffect(() => {
    load();
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

  async function setStatus(id: string, status: Order['status']) {
    setBusy(id);
    try {
      await api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const counts = Object.fromEntries(
    Object.entries(board).map(([k, v]) => [k, v.length]),
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Pedidos{' '}
          <span className="page-crumb">
            / {counts.PENDING + counts.CONFIRMED + counts.READY} en curso
          </span>
        </h1>
        <div className="flex gap-2 items-center">
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
          <div key={col.key} className="card">
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
            <div className="p-3 space-y-2.5 max-h-[70vh] overflow-auto">
              {board[col.key]?.length === 0 && (
                <div className="text-mute text-sm text-center py-4">—</div>
              )}
              {board[col.key]?.map((o) => (
                <div
                  key={o.id}
                  className="border border-line2 rounded-lg p-3 bg-bg2/30 hover:bg-bg2 transition"
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
