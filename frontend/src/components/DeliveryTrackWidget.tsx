'use client';
import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type DeliveryStatus =
  | 'WAITING_COURIER'
  | 'COURIER_ASSIGNED'
  | 'PICKED_UP'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELLED';

type OrderRow = {
  code: string;
  orderStatus: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  isDelivery: boolean;
  total: number | null;
  createdAt: string;
  delivery: {
    status: DeliveryStatus;
    etaMinutes: number | null;
    courierName: string | null;
  } | null;
};

const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  WAITING_COURIER: 'Buscando repartidor',
  COURIER_ASSIGNED: 'Repartidor asignado',
  PICKED_UP: 'Recogido',
  ON_THE_WAY: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};
const ORDER_LABEL: Record<string, string> = {
  PENDING: 'Recibido',
  CONFIRMED: 'En preparación',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

function statusOf(o: OrderRow): { label: string; done: boolean; cancelled: boolean } {
  if (o.orderStatus === 'CANCELLED' || o.delivery?.status === 'CANCELLED') {
    return { label: 'Cancelado', done: false, cancelled: true };
  }
  if (o.delivery) {
    return {
      label: DELIVERY_LABEL[o.delivery.status],
      done: o.delivery.status === 'DELIVERED',
      cancelled: false,
    };
  }
  return {
    label: ORDER_LABEL[o.orderStatus] ?? o.orderStatus,
    done: o.orderStatus === 'DELIVERED',
    cancelled: false,
  };
}

export function DeliveryTrackWidget({
  slug,
  primary,
}: {
  slug: string;
  primary: string;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const storeKey = `clubify:trackphone:${slug}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storeKey);
      if (saved) setPhone(saved);
    } catch {
      /* noop */
    }
  }, [storeKey]);

  async function search() {
    const p = phone.trim();
    if (p.replace(/\D/g, '').length < 7) {
      alert('Escribe tu número de teléfono completo.');
      return;
    }
    setLoading(true);
    try {
      localStorage.setItem(storeKey, p);
    } catch {
      /* noop */
    }
    try {
      const res = await fetch(
        `${API}/api/public/deliveries/by-phone/${encodeURIComponent(slug)}?phone=${encodeURIComponent(p)}`,
      );
      const data = res.ok ? await res.json() : { orders: [] };
      setOrders(data?.orders ?? []);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }

  // Refresca mientras el panel está abierto y ya hubo búsqueda.
  useEffect(() => {
    if (!open || orders === null) return;
    const t = setInterval(() => {
      search();
    }, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orders === null]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed z-40 flex items-center gap-2 rounded-full shadow-lg text-white font-semibold text-sm"
        style={{
          left: 16,
          bottom: 16,
          background: primary,
          padding: '10px 16px',
          boxShadow: '0 8px 20px rgba(0,0,0,.2)',
        }}
        aria-label="Seguimiento de mis pedidos"
      >
        🛵 Mis pedidos
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center"
          style={{ background: 'rgba(15,23,42,.5)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden"
            style={{ maxHeight: '85vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-3 text-white"
              style={{ background: primary }}
            >
              <div className="font-bold">🛵 Seguimiento de pedidos</div>
              <button onClick={() => setOpen(false)} className="text-2xl leading-none">
                ×
              </button>
            </div>

            <div className="p-5 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 52px)' }}>
              <label className="text-[13px] font-semibold text-gray-600">
                Tu teléfono
              </label>
              <div className="flex gap-2 mt-1.5">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  placeholder="Ej: 300 123 4567"
                  className="flex-1 rounded-[10px] px-3 py-2.5 text-sm outline-none border border-gray-300 focus:border-gray-500"
                  inputMode="tel"
                />
                <button
                  onClick={search}
                  disabled={loading}
                  className="text-white font-semibold rounded-[10px] px-4 text-sm"
                  style={{ background: primary, opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? '…' : 'Ver'}
                </button>
              </div>
              <p className="text-[11.5px] text-gray-400 mt-1.5">
                Usa el mismo número con el que hiciste el pedido.
              </p>

              <div className="mt-4 space-y-2.5">
                {orders !== null && orders.length === 0 && !loading && (
                  <div className="text-center text-sm text-gray-400 py-6">
                    No encontramos pedidos con ese número.
                  </div>
                )}
                {(orders ?? []).map((o) => {
                  const st = statusOf(o);
                  return (
                    <a
                      key={o.code}
                      href={`/o/${o.code}`}
                      className="block rounded-[12px] p-3 border border-gray-200 hover:border-gray-300 transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-sm text-gray-900">
                          Pedido #{o.code}
                        </div>
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={
                            st.cancelled
                              ? { background: '#fee2e2', color: '#b91c1c' }
                              : st.done
                                ? { background: '#dcfce7', color: '#15803d' }
                                : { background: '#e0f2fe', color: '#0369a1' }
                          }
                        >
                          {st.label}
                        </span>
                      </div>
                      <div className="text-[12px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
                        {o.total != null && <span>${o.total.toFixed(2)}</span>}
                        {o.delivery?.etaMinutes != null && !st.done && (
                          <span>⏱️ ~{o.delivery.etaMinutes} min</span>
                        )}
                        {o.delivery?.courierName && <span>🛵 {o.delivery.courierName}</span>}
                        <span className="text-sky-600 font-medium">Ver detalle →</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
