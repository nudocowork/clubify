'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { api } from '@/lib/api';
import { getOrdersSocket } from '@/lib/socket';
import { playOrderBeep } from '@/lib/notify';

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
};

const COLS = [
  { key: 'PENDING' as const, labelKey: 'colNew', accent: '#F59E0B' },
  { key: 'CONFIRMED' as const, labelKey: 'colInKitchen', accent: '#22C55E' },
  { key: 'READY' as const, labelKey: 'colReadyToDeliver', accent: '#16A34A' },
];

function fmtElapsed(d: string, t: (key: string, vars?: Record<string, any>) => string) {
  const min = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 1) return t('elapsedJustNow');
  if (min < 60) return t('elapsedMinutes', { min });
  const h = Math.floor(min / 60);
  return t('elapsedHours', { h, min: min % 60 });
}

function elapsedToneClass(d: string, status: Order['status']): string {
  // Pintar en rojo si pasó mucho tiempo en una etapa
  const min = (Date.now() - new Date(d).getTime()) / 60000;
  if (status === 'READY' && min > 10) return 'ring-2 ring-red-500 bg-red-50';
  if (status === 'CONFIRMED' && min > 25) return 'ring-2 ring-red-500 bg-red-50';
  if (status === 'PENDING' && min > 5) return 'ring-2 ring-amber-500 bg-amber-50';
  return 'bg-white';
}

export default function KitchenDisplay() {
  const t = useTranslations('app_orders_display');
  const [board, setBoard] = useState<Record<string, Order[]>>({
    PENDING: [],
    CONFIRMED: [],
    READY: [],
    DELIVERED: [],
    CANCELLED: [],
  });
  const [now, setNow] = useState(Date.now());
  const [live, setLive] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const stateRef = useRef(board);
  stateRef.current = board;

  async function load() {
    try {
      const data = await api<typeof board>('/orders/board?days=1');
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
    const isNew = !seenRef.current.has(o.id);
    seenRef.current.add(o.id);
    setBoard((cur) => {
      const next = { ...cur };
      for (const k of Object.keys(next)) {
        next[k] = (next[k] ?? []).filter((x) => x.id !== o.id);
      }
      next[o.status] = [o, ...(next[o.status] ?? [])];
      return next;
    });
    if (isNew && o.status === 'PENDING') {
      playOrderBeep();
    }
  }

  async function setStatus(id: string, status: Order['status']) {
    try {
      await api(`/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    } catch {}
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

    const t1 = setInterval(load, 60000);
    const t2 = setInterval(() => setNow(Date.now()), 30000); // refresh time-ago

    // Salir con ESC
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') window.location.href = '/app/orders';
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    }
    window.addEventListener('keydown', onKey);

    // Pedir wake lock para que no se duerma la pantalla en kitchen TV
    let wakeLock: any = null;
    (async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    })();

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('order:upsert', onUpsert);
      clearInterval(t1);
      clearInterval(t2);
      window.removeEventListener('keydown', onKey);
      if (wakeLock) {
        try {
          wakeLock.release();
        } catch {}
      }
    };
  }, []);

  function toggleFullscreen() {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // Stats banner: pedidos hoy + tiempo promedio (now hace que se recompute)
  const stats = useMemo(() => {
    void now;
    const all = [
      ...(board.PENDING ?? []),
      ...(board.CONFIRMED ?? []),
      ...(board.READY ?? []),
      ...(board.DELIVERED ?? []),
    ];
    return {
      pending: board.PENDING?.length ?? 0,
      cooking: board.CONFIRMED?.length ?? 0,
      ready: board.READY?.length ?? 0,
      delivered: board.DELIVERED?.length ?? 0,
      total: all.length,
    };
  }, [board, now]);

  return (
    <div className="fixed inset-0 z-40 bg-ink text-white flex flex-col">
      <header className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div className="font-bold text-2xl tracking-tight">
            🍳 {t('headerKitchen')}{' '}
            <span className="text-mute2 font-normal">{t('headerLive')}</span>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
              live ? 'bg-ok/20 text-ok' : 'bg-mute/20 text-mute2'
            }`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full inline-block mr-1.5"
              style={{ background: live ? '#16A34A' : '#9CA3AF' }}
            />
            {live ? t('statusLive') : t('statusOffline')}
          </span>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <Stat label={t('statNew')} value={stats.pending} accent="#F59E0B" />
          <Stat label={t('statInKitchen')} value={stats.cooking} accent="#22C55E" />
          <Stat label={t('statReady')} value={stats.ready} accent="#16A34A" />
          <Stat label={t('statDeliveredToday')} value={stats.delivered} accent="#9CA3AF" />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="text-xs px-3 py-1.5 rounded-pill bg-white/10 hover:bg-white/15 border border-white/20"
            title={t('keyFTitle')}
          >
            ⛶ {t('fullscreen')}
          </button>
          <Link
            href="/app/orders"
            className="text-xs px-3 py-1.5 rounded-pill bg-white/10 hover:bg-white/15 border border-white/20"
            title={t('keyEscTitle')}
          >
            {t('exit')}
          </Link>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 p-3 md:p-5 overflow-hidden">
        {COLS.map((col) => (
          <div
            key={col.key}
            className="bg-white/5 rounded-2xl flex flex-col overflow-hidden border border-white/10"
          >
            <div
              className="px-4 py-3 flex items-center justify-between border-b border-white/10"
              style={{ background: col.accent + '20' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: col.accent }}
                />
                <span className="font-semibold text-sm">{t(col.labelKey)}</span>
              </div>
              <span
                className="text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: col.accent, color: '#fff' }}
              >
                {board[col.key]?.length ?? 0}
              </span>
            </div>

            <div className="flex-1 overflow-auto p-2.5 space-y-2">
              {(board[col.key] ?? []).length === 0 ? (
                <div className="text-mute2 text-center text-sm py-12 italic">
                  {t('empty')}
                </div>
              ) : (
                (board[col.key] ?? []).map((o) => (
                  <DisplayCard
                    key={o.id}
                    order={o}
                    accent={col.accent}
                    onAdvance={(next) => setStatus(o.id, next)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <footer className="px-6 py-2.5 border-t border-white/10 text-[11px] text-mute2 flex items-center justify-between flex-wrap gap-2">
        <div>
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/10">F</kbd>{' '}
          {t('footerFullscreen')} ·{' '}
          <kbd className="font-mono px-1.5 py-0.5 rounded bg-white/10">ESC</kbd>{' '}
          {t('footerExit')}
        </div>
        <div>
          {new Date().toLocaleString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </footer>
    </div>
  );
}

function DisplayCard({
  order: o,
  accent,
  onAdvance,
}: {
  order: Order;
  accent: string;
  onAdvance: (next: Order['status']) => void;
}) {
  const t = useTranslations('app_orders_display');
  const tone = elapsedToneClass(o.createdAt, o.status);
  const next: Record<string, Order['status']> = {
    PENDING: 'CONFIRMED',
    CONFIRMED: 'READY',
    READY: 'DELIVERED',
  };
  const nextLabelKey: Record<string, string> = {
    PENDING: 'advanceAccept',
    CONFIRMED: 'advanceReady',
    READY: 'advanceDelivered',
  };

  return (
    <div
      className={`rounded-xl p-3 text-ink ${tone} transition shadow-md`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono font-bold text-lg leading-none">
          #{o.code}
        </div>
        <div className="text-xs text-mute font-semibold">
          {fmtElapsed(o.createdAt, t)}
        </div>
      </div>
      <div className="text-sm font-semibold mt-1.5 truncate">
        {o.customer?.fullName ?? '—'}
      </div>
      <div className="text-[11px] text-mute mb-2">
        {o.fulfillment === 'DINE_IN'
          ? `🍽 ${t('fulfillmentTable', { table: o.tableNumber ?? '?' })}`
          : o.fulfillment === 'PICKUP'
          ? `🥡 ${t('fulfillmentPickup')}`
          : `🛵 ${t('fulfillmentDelivery')}`}
      </div>

      <div className="space-y-0.5 text-sm border-t border-line2 pt-2">
        {(o.items ?? []).slice(0, 5).map((it: any, i: number) => (
          <div key={i}>
            <div className="flex items-baseline gap-2">
              <span className="font-bold text-ink">{it.qty}×</span>
              <span className="flex-1 truncate">{it.name}</span>
            </div>
            {Array.isArray(it.extras) && it.extras.length > 0 && (
              <div className="pl-6 text-[11px] text-amber-300">
                + {it.extras.map((e: any) => e.name).join(' · ')}
              </div>
            )}
            {it.note && (
              <div className="pl-6 text-[11px] text-mute2 italic">↳ {it.note}</div>
            )}
          </div>
        ))}
        {(o.items?.length ?? 0) > 5 && (
          <div className="text-[11px] text-mute italic">
            {t('moreItems', { count: o.items.length - 5 })}
          </div>
        )}
      </div>

      {next[o.status] && (
        <button
          onClick={() => onAdvance(next[o.status])}
          className="w-full mt-3 text-white font-semibold text-sm py-2 rounded-pill"
          style={{ background: accent }}
        >
          {t(nextLabelKey[o.status])} →
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-2xl font-bold" style={{ color: accent }}>
        {value}
      </span>
      <span className="text-mute2 text-xs uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
