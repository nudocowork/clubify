'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { BrandBadge, type BrandBadgeBrand } from '@/components/BrandBadge';
import { DeliveryChat, type ChatMessage } from '@/components/DeliveryChat';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Order = {
  id: string;
  code: string;
  status: 'PENDING' | 'CONFIRMED' | 'READY' | 'DELIVERED' | 'CANCELLED';
  total: number;
  fulfillment: string;
  tableNumber: string | null;
  items: any[];
  createdAt: string;
  customerNote: string | null;
  rating: number | null;
  ratingComment: string | null;
  ratedAt: string | null;
  tenant: {
    brandName: string;
    logoUrl: string | null;
    primaryColor: string;
    slug: string;
    currency?: string | null;
    currencySymbol?: string | null;
  };
  brand?: BrandBadgeBrand;
  customer: { fullName: string; phone: string };
  delivery?: {
    status: DeliveryStatus;
    courierName: string | null;
    courierPlate: string | null;
    etaMinutes: number | null;
    assignedAt: string | null;
    pickedUpAt: string | null;
    onTheWayAt: string | null;
    deliveredAt: string | null;
    deliveryCompany: { name: string; whatsapp: string | null } | null;
  } | null;
};

type DeliveryStatus =
  | 'WAITING_COURIER'
  | 'COURIER_ASSIGNED'
  | 'PICKED_UP'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELLED';

const DELIVERY_FLOW: DeliveryStatus[] = [
  'WAITING_COURIER',
  'COURIER_ASSIGNED',
  'PICKED_UP',
  'ON_THE_WAY',
  'DELIVERED',
];
const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  WAITING_COURIER: 'Buscando repartidor',
  COURIER_ASSIGNED: 'Repartidor asignado',
  PICKED_UP: 'Pedido recogido',
  ON_THE_WAY: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'READY', 'DELIVERED'] as const;
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Enviado',
  CONFIRMED: 'Confirmado',
  READY: 'Listo',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

// Respeta la moneda del negocio y el símbolo custom (ej "Ref." en lugar
// de "$"). Mismo enfoque que el storefront: formatToParts + reemplazo de
// la parte "currency".
function fmt(
  n: number,
  currency: string = 'COP',
  symbolOverride: string | null = null,
) {
  try {
    const parts = new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency || 'COP',
      maximumFractionDigits: 0,
    }).formatToParts(n);
    const sym = symbolOverride?.trim();
    if (sym) {
      return parts.map((p) => (p.type === 'currency' ? sym : p.value)).join('');
    }
    return parts.map((p) => p.value).join('');
  } catch {
    const sym = symbolOverride?.trim();
    return `${sym || '$'}${n.toFixed(0)}`;
  }
}

export default function OrderStatus() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);

  // HOTFIX 2026-06-05 (bug I): fetch sin AbortController + interval cada
  // 10s. Si el cliente navega o el `code` cambia, las respuestas en
  // vuelo pueden setear data del code viejo. Además, sin error state, un
  // 404/500 en el primer fetch dejaba "Cargando…" perpetuo. Ahora cada
  // request se cancela con el cleanup del effect y mostramos error UI.
  // `refetchTick` permite a RatingWidget pedir un re-fetch fresh tras
  // calificar (bump del counter → useEffect re-corre).
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoadErr(null);

    async function load() {
      try {
        const res = await fetch(`${API}/api/public/orders/${code}`, {
          signal: ctrl.signal,
        });
        if (cancelled) return;
        if (res.ok) {
          setOrder(await res.json());
        } else if (!order) {
          setLoadErr(`Pedido no encontrado (${res.status})`);
        }
      } catch (e: any) {
        if (cancelled || e?.name === 'AbortError') return;
        if (!order) setLoadErr(e?.message || 'Error de red');
      }
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, refetchTick]);

  if (loadErr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-bg">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-2">😔</div>
          <div className="font-semibold">No pudimos cargar el pedido</div>
          <div className="text-sm text-mute mt-1">{loadErr}</div>
        </div>
      </div>
    );
  }

  if (!order) return <div className="p-8 text-mute text-center">Cargando…</div>;

  const idx = STATUS_FLOW.indexOf(order.status as any);
  const cancelled = order.status === 'CANCELLED';
  const primary = order.tenant.primaryColor;

  return (
    <div className="min-h-screen bg-bg pb-12">
      <div className="max-w-md mx-auto px-5 pt-8">
        <div className="text-center mb-6">
          <div
            className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white text-3xl mb-3"
            style={{ background: cancelled ? '#DC2626' : primary }}
          >
            {cancelled ? '✕' : '✓'}
          </div>
          <h1 className="text-2xl font-bold">
            {cancelled ? 'Pedido cancelado' : `Pedido #${order.code}`}
          </h1>
          <p className="text-sm text-mute mt-1">
            {cancelled
              ? 'El negocio canceló este pedido.'
              : 'El negocio te confirmará en breve.'}
          </p>
        </div>

        {!cancelled && (
          <div className="card card-pad mb-4">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
              Estado
            </div>
            <div className="flex items-center justify-between">
              {STATUS_FLOW.map((s, i) => (
                <div key={s} className="flex-1 flex items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-none"
                    style={{
                      background: i <= idx ? primary : '#E5E7EB',
                      color: i <= idx ? '#fff' : '#9CA3AF',
                    }}
                  >
                    {i + 1}
                  </div>
                  {i < STATUS_FLOW.length - 1 && (
                    <div
                      className="flex-1 h-0.5"
                      style={{
                        background: i < idx ? primary : '#E5E7EB',
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-mute mt-2">
              {STATUS_FLOW.map((s) => (
                <div key={s} className="flex-1 text-center">
                  {STATUS_LABEL[s]}
                </div>
              ))}
            </div>
          </div>
        )}

        {!cancelled && order.delivery && order.delivery.status !== 'CANCELLED' && (
          <div className="card card-pad mb-4">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
              🛵 Seguimiento del domicilio
            </div>
            {(() => {
              const d = order.delivery!;
              const dIdx = DELIVERY_FLOW.indexOf(d.status);
              return (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-xs font-bold px-2.5 py-1 rounded-full"
                      style={{ background: primary, color: '#fff' }}
                    >
                      {DELIVERY_LABEL[d.status]}
                    </span>
                    {d.etaMinutes != null && d.status !== 'DELIVERED' && (
                      <span className="text-xs text-mute">⏱️ ~{d.etaMinutes} min</span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {DELIVERY_FLOW.map((s, i) => (
                      <div key={s} className="flex items-center gap-2.5">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-none"
                          style={{
                            background: i <= dIdx ? primary : '#E5E7EB',
                            color: i <= dIdx ? '#fff' : '#9CA3AF',
                          }}
                        >
                          {i <= dIdx ? '✓' : i + 1}
                        </div>
                        <span
                          className="text-sm"
                          style={{ color: i <= dIdx ? '#111827' : '#9CA3AF' }}
                        >
                          {DELIVERY_LABEL[s]}
                        </span>
                      </div>
                    ))}
                  </div>
                  {(d.courierName || d.deliveryCompany) && (
                    <div className="border-t border-line2 mt-3 pt-3 text-sm text-mute space-y-0.5">
                      {d.deliveryCompany && <div>🏢 {d.deliveryCompany.name}</div>}
                      {d.courierName && (
                        <div>
                          🛵 {d.courierName}
                          {d.courierPlate ? ` · ${d.courierPlate}` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* El chat del domicilio SOLO aparece si el pedido tiene un delivery
            REAL asignado (order.delivery != null) — es decir, el negocio está
            en una red de domicilios. Antes salía con solo fulfillment=DELIVERY,
            apareciendo en negocios (ej. de Sellea) que NO usan domicilios. */}
        {!cancelled && order.delivery && order.delivery.status !== 'CANCELLED' && (
          <div className="card card-pad mb-4">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
              💬 Chat del domicilio
            </div>
            <DeliveryChat
              meRole="CUSTOMER"
              primary={primary}
              load={async () => {
                const r = await fetch(`${API}/api/public/deliveries/${order.code}/chat`);
                return r.ok ? ((await r.json()) as ChatMessage[]) : [];
              }}
              send={async (body) => {
                const r = await fetch(`${API}/api/public/deliveries/${order.code}/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ body }),
                });
                if (!r.ok) throw new Error('No se pudo enviar.');
                return (await r.json()) as ChatMessage[];
              }}
            />
          </div>
        )}

        <div className="card card-pad">
          <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
            Tu pedido
          </div>
          <div className="space-y-1">
            {order.items.map((it: any, i: number) => (
              <div key={i} className="text-sm">
                <div className="flex justify-between">
                  <span>
                    {it.qty}x {it.name}
                  </span>
                  <span>
                    {fmt(
                      it.lineTotal,
                      order.tenant.currency ?? 'COP',
                      order.tenant.currencySymbol ?? null,
                    )}
                  </span>
                </div>
                {Array.isArray(it.extras) &&
                  it.extras.map((e: any, j: number) => (
                    <div key={j} className="text-xs text-mute pl-4">
                      + {e.name}
                      {Number(e.price) > 0
                        ? ` (${fmt(
                            Number(e.price),
                            order.tenant.currency ?? 'COP',
                            order.tenant.currencySymbol ?? null,
                          )})`
                        : ''}
                    </div>
                  ))}
                {it.note && (
                  <div className="text-xs text-mute pl-4 italic">↳ {it.note}</div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-line2 mt-3 pt-3 flex justify-between font-semibold">
            <span>Total</span>
            <span>
              {fmt(
                Number(order.total),
                order.tenant.currency ?? 'COP',
                order.tenant.currencySymbol ?? null,
              )}
            </span>
          </div>
          {order.customerNote && (
            <div className="text-xs text-mute mt-3 italic">
              📝 {order.customerNote}
            </div>
          )}
        </div>

        {(order.status === 'DELIVERED' || order.status === 'READY') && (
          <RatingWidget
            order={order}
            onRated={() => setRefetchTick((t) => t + 1)}
            primary={primary}
          />
        )}

        <Link
          href={`/m/${order.tenant.slug}`}
          className="btn-ghost w-full justify-center mt-4"
        >
          ← Volver al menú
        </Link>
        {/* Marca del negocio (per marca blanca). Fallback Clubify mientras
            el backend propaga el deploy. */}
        <BrandBadge
          brand={
            order.brand ?? {
              name: 'Clubify',
              websiteUrl: 'https://soyclubify.com',
              initial: 'C',
              primaryColor: '#22C55E',
              attribution: { madeWith: 'Hecho con Clubify' },
            }
          }
        />
      </div>
    </div>
  );
}

function RatingWidget({
  order,
  onRated,
  primary,
}: {
  order: Order;
  onRated: () => void;
  primary: string;
}) {
  const [hover, setHover] = useState(0);
  const [picked, setPicked] = useState(order.rating ?? 0);
  const [comment, setComment] = useState(order.ratingComment ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Si ya calificó, mostrar estado leído
  if (order.ratedAt) {
    return (
      <div className="card card-pad mt-4 text-center">
        <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
          Tu calificación
        </div>
        <div className="text-3xl">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              style={{
                color: i < (order.rating ?? 0) ? '#F59E0B' : '#E5E7EB',
              }}
            >
              ★
            </span>
          ))}
        </div>
        {order.ratingComment && (
          <p className="text-xs text-mute mt-2 italic">
            "{order.ratingComment}"
          </p>
        )}
        <p className="text-[11px] text-mute mt-3">
          ¡Gracias por tu opinión! 🙏
        </p>
      </div>
    );
  }

  async function submit() {
    if (picked < 1) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`${API}/api/public/orders/${order.code}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: picked, comment }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || 'No se pudo enviar');
      }
      onRated();
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card-pad mt-4">
      <div className="text-center">
        <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
          ¿Cómo estuvo tu pedido?
        </div>
        <div className="text-4xl select-none mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setPicked(n)}
              className="px-1 transition-transform hover:scale-110"
              style={{
                color: n <= (hover || picked) ? '#F59E0B' : '#E5E7EB',
              }}
              aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
            >
              ★
            </button>
          ))}
        </div>
        {picked > 0 && (
          <div className="text-sm font-medium" style={{ color: primary }}>
            {['😞 Mal', '😐 Regular', '🙂 Bien', '😄 Muy bien', '🤩 Excelente'][picked - 1]}
          </div>
        )}
      </div>

      {picked > 0 && (
        <>
          <textarea
            className="input mt-4 text-sm resize-y min-h-[64px]"
            maxLength={500}
            placeholder="Cuéntanos qué te pareció (opcional)…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="text-[10px] text-mute text-right mt-1">
            {comment.length}/500
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={submit}
            className="btn-primary w-full justify-center mt-2"
            style={{ background: primary }}
          >
            {saving ? 'Enviando…' : 'Enviar calificación'}
          </button>
          {err && (
            <div className="text-xs text-red-600 mt-2 text-center">{err}</div>
          )}
        </>
      )}
    </div>
  );
}
