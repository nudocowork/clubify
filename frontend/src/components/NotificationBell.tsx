'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { getOrdersSocket } from '@/lib/socket';

type Notif = {
  id: string;
  ts: number;
  type: 'order_new' | 'order_paid' | 'order_status';
  title: string;
  body: string;
  href: string;
  read: boolean;
};

const STORE_KEY = 'clubify_notifs';
const MAX = 30;

function loadStored(): Notif[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStored(items: Notif[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {}
}

function rid() {
  return Math.random().toString(36).slice(2, 11);
}

function timeAgo(ts: number) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function NotificationBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setItems(loadStored());
    const sock = getOrdersSocket();

    function pushNotif(n: Omit<Notif, 'id' | 'ts' | 'read'>) {
      setItems((prev) => {
        const next = [
          { ...n, id: rid(), ts: Date.now(), read: false },
          ...prev,
        ].slice(0, MAX);
        saveStored(next);
        return next;
      });
    }

    function onUpsert(o: any) {
      // Detectar tipo según el cambio
      if (o.paymentStatus === 'PAID' && o._wasPending !== false) {
        pushNotif({
          type: 'order_paid',
          title: `💳 Pago recibido #${o.code}`,
          body: `${o.customer?.fullName ?? 'Cliente'} pagó $${Number(o.total).toLocaleString('es-CO')}`,
          href: '/app/orders',
        });
      } else if (o.status === 'PENDING') {
        pushNotif({
          type: 'order_new',
          title: `🛒 Nuevo pedido #${o.code}`,
          body: `${o.customer?.fullName ?? 'Cliente'} pidió ${(o.items?.length ?? 0)} items`,
          href: '/app/orders',
        });
      } else {
        pushNotif({
          type: 'order_status',
          title: `📦 Pedido #${o.code} → ${o.status}`,
          body: o.customer?.fullName ?? 'Cliente',
          href: '/app/orders',
        });
      }

      // Notificación nativa del browser si está permitido
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.visibilityState !== 'visible'
      ) {
        try {
          new Notification(`Clubify · #${o.code}`, {
            body: `${o.customer?.fullName ?? 'Cliente'} · ${o.status}`,
            icon: '/icons/icon-192.png',
          });
        } catch {}
      }
    }

    sock.on('order:upsert', onUpsert);

    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClick);

    return () => {
      sock.off('order:upsert', onUpsert);
      window.removeEventListener('mousedown', onClick);
    };
  }, []);

  function markAllRead() {
    setItems((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveStored(next);
      return next;
    });
  }

  function clearAll() {
    setItems([]);
    saveStored([]);
  }

  async function requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  const unread = items.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          requestPermission();
          if (!open) setTimeout(markAllRead, 1500);
        }}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-sidebar-mute hover:bg-sidebar-hover hover:text-white transition relative"
        title="Notificaciones"
      >
        <Icon name="bell" size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-card shadow-2xl border border-line z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="font-semibold text-sm text-ink">Notificaciones</div>
            {items.length > 0 && (
              <button
                className="text-xs text-mute hover:text-ink"
                onClick={clearAll}
              >
                Limpiar
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-auto">
            {items.length === 0 ? (
              <div className="text-center text-mute text-sm py-10">
                <div className="text-3xl mb-2">🔕</div>
                Sin novedades por ahora.
                <div className="text-xs mt-2">
                  Las nuevas órdenes y pagos aparecerán aquí.
                </div>
              </div>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className={`block px-4 py-3 border-b border-line2 hover:bg-bg2 transition ${
                    n.read ? '' : 'bg-brand-soft/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">
                        {n.title}
                      </div>
                      <div className="text-xs text-mute truncate">{n.body}</div>
                    </div>
                    <div className="text-[11px] text-mute whitespace-nowrap">
                      {timeAgo(n.ts)}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
