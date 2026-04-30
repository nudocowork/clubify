'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  addToCart,
  cartTotals,
  CartItem,
  readCart,
  updateQty,
  clearCart,
} from '@/lib/cart';
import { Icon } from '@/components/Icon';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Storefront = {
  id: string;
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  whatsappPhone: string | null;
  instagramUrl: string | null;
  mapsUrl: string | null;
  currency: string;
  description: string;
  heroImageUrl: string | null;
  promotions: any[];
};

type Variant = { id: string; groupName: string; name: string; priceDelta: number; isDefault: boolean };
type Extra = { id: string; name: string; price: number; maxQty: number };
type Product = {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  imageUrl: string | null;
  tags: string[];
  variants: Variant[];
  extras: Extra[];
};
type Category = {
  id: string;
  name: string;
  products: Product[];
};

function fmt(n: number, currency = 'COP') {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n.toFixed(0)}`;
  }
}

export default function StorefrontPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [s, setS] = useState<Storefront | null>(null);
  const [menu, setMenu] = useState<Category[]>([]);
  const [tab, setTab] = useState<'menu' | 'card' | 'promos'>('menu');
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/public/m/${slug}`).then((r) => r.json()).then(setS);
    fetch(`${API}/api/public/m/${slug}/menu`).then((r) => r.json()).then(setMenu);
    setCart(readCart(slug));
    const handler = () => setCart(readCart(slug));
    window.addEventListener(`cart:${slug}`, handler);
    return () => window.removeEventListener(`cart:${slug}`, handler);
  }, [slug]);

  if (!s) return <div className="p-8 text-mute">Cargando…</div>;

  const totals = cartTotals(cart);
  const primary = s.primaryColor;

  return (
    <div
      className="min-h-screen pb-32"
      style={{ background: '#FAFBFC' }}
    >
      {/* Hero */}
      <header className="px-5 pt-8 pb-5 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          {s.logoUrl ? (
            <img src={s.logoUrl} alt="" className="w-12 h-12 rounded-xl" />
          ) : (
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: primary }}
            >
              {s.brandName[0]}
            </div>
          )}
          <div>
            <div className="font-bold text-xl">{s.brandName}</div>
            <div className="text-xs text-mute">{s.description}</div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap mt-3">
          {s.whatsappPhone && (
            <a
              href={`https://wa.me/${s.whatsappPhone.replace(/\D/g, '')}`}
              target="_blank"
              className="px-3 py-1.5 rounded-full text-white text-sm font-medium"
              style={{ background: '#25D366' }}
            >
              💬 WhatsApp
            </a>
          )}
          {s.instagramUrl && (
            <a
              href={s.instagramUrl}
              target="_blank"
              className="px-3 py-1.5 rounded-full bg-bg2 text-sm font-medium"
            >
              📷 Instagram
            </a>
          )}
          {s.mapsUrl && (
            <a
              href={s.mapsUrl}
              target="_blank"
              className="px-3 py-1.5 rounded-full bg-bg2 text-sm font-medium"
            >
              📍 Cómo llegar
            </a>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 max-w-2xl mx-auto">
        <div className="flex gap-1 p-1 rounded-pill bg-white border border-line">
          {(['menu', 'card', 'promos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-pill text-sm font-medium transition"
              style={{
                background: tab === t ? primary : 'transparent',
                color: tab === t ? '#fff' : '#6B7280',
              }}
            >
              {t === 'menu' ? 'Menú' : t === 'card' ? 'Mi Tarjeta' : 'Promos'}
            </button>
          ))}
        </div>
      </div>

      {/* Menú */}
      {tab === 'menu' && (
        <div className="max-w-2xl mx-auto mt-4 px-5">
          {menu.length === 0 && (
            <div className="text-center text-mute py-12">Aún no hay menú publicado.</div>
          )}
          {menu.map((cat) => (
            <section key={cat.id} className="mb-6">
              <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-3">
                {cat.name}
              </h2>
              <div className="space-y-2.5">
                {cat.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setOpenProduct(p)}
                    className="w-full bg-white border border-line rounded-card overflow-hidden text-left transition hover:shadow-md2 flex"
                  >
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="w-24 h-24 object-cover flex-none"
                      />
                    ) : (
                      <div className="w-24 h-24 bg-bg2 flex-none flex items-center justify-center text-2xl text-mute">
                        🍽
                      </div>
                    )}
                    <div className="flex-1 p-3 min-w-0">
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className="text-xs text-mute mt-0.5 line-clamp-2">
                        {p.description}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="font-bold text-sm">{fmt(Number(p.basePrice), s.currency)}</div>
                        <div className="flex gap-1">
                          {p.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div
                      className="w-12 flex items-center justify-center text-white text-xl flex-none"
                      style={{ background: primary }}
                    >
                      +
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Promos */}
      {tab === 'promos' && (
        <div className="max-w-2xl mx-auto mt-4 px-5 space-y-3">
          {s.promotions.length === 0 && (
            <div className="text-center text-mute py-12">No hay promos activas.</div>
          )}
          {s.promotions.map((p) => (
            <div
              key={p.id}
              className="rounded-card p-5 text-white"
              style={{ background: `linear-gradient(135deg, ${primary}, ${s.secondaryColor})` }}
            >
              <div className="text-xs uppercase tracking-wider opacity-85">{p.type}</div>
              <div className="font-bold text-lg mt-1">{p.name}</div>
              <div className="text-sm opacity-90 mt-1">{p.description}</div>
              {p.validUntil && (
                <div className="text-xs opacity-75 mt-3">
                  Hasta {new Date(p.validUntil).toLocaleDateString('es-CO')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tarjeta */}
      {tab === 'card' && (
        <div className="max-w-md mx-auto mt-6 px-5 text-center">
          <p className="text-sm text-mute mb-4">
            Ingresa tu teléfono para ver tu tarjeta de fidelización.
          </p>
          <input
            className="input mb-3 text-center"
            placeholder="+57 300 ..."
          />
          <button
            className="btn-primary w-full justify-center"
            style={{ background: primary, borderColor: primary }}
          >
            <Icon name="card" /> Ver mi tarjeta
          </button>
          <p className="text-xs text-mute mt-3">
            Si todavía no tienes tarjeta, te llegará al hacer tu primer pedido.
          </p>
        </div>
      )}

      {/* Bottom dock con carrito */}
      {totals.count > 0 && !showCart && !showCheckout && (
        <div className="fixed bottom-0 inset-x-0 px-5 pb-5 pt-3 bg-gradient-to-t from-white to-white/80 max-w-2xl mx-auto">
          <button
            onClick={() => setShowCart(true)}
            className="w-full rounded-pill text-white font-semibold py-3.5 flex items-center justify-between px-5"
            style={{ background: primary }}
          >
            <span>🛒 {totals.count} items</span>
            <span>{fmt(totals.subtotal, s.currency)}</span>
            <span>Pedir →</span>
          </button>
        </div>
      )}

      {/* Modal de producto */}
      {openProduct && (
        <ProductModal
          product={openProduct}
          slug={slug}
          primary={primary}
          currency={s.currency}
          onClose={() => setOpenProduct(null)}
        />
      )}

      {/* Sheet de carrito */}
      {showCart && (
        <CartSheet
          items={cart}
          slug={slug}
          primary={primary}
          currency={s.currency}
          onClose={() => setShowCart(false)}
          onCheckout={() => {
            setShowCart(false);
            setShowCheckout(true);
          }}
        />
      )}

      {/* Checkout */}
      {showCheckout && (
        <CheckoutSheet
          items={cart}
          slug={slug}
          primary={primary}
          currency={s.currency}
          onClose={() => setShowCheckout(false)}
        />
      )}
    </div>
  );
}

// =====================================================
// Product modal
// =====================================================
function ProductModal({
  product,
  slug,
  primary,
  currency,
  onClose,
}: {
  product: Product;
  slug: string;
  primary: string;
  currency: string;
  onClose: () => void;
}) {
  const defaultVar = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  const [variantId, setVariantId] = useState<string | undefined>(defaultVar?.id);
  const [extras, setExtras] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');

  const variant = product.variants.find((v) => v.id === variantId);
  const extrasObj = product.extras.filter((e) => extras.includes(e.id));
  const unit =
    Number(product.basePrice) +
    (variant ? Number(variant.priceDelta) : 0) +
    extrasObj.reduce((s, e) => s + Number(e.price), 0);
  const total = unit * qty;

  function add() {
    addToCart(slug, {
      productId: product.id,
      variantId,
      variantName: variant?.name,
      extraIds: extras,
      extras: extrasObj,
      qty,
      name: product.name + (variant ? ` (${variant.name})` : ''),
      unitPrice: unit,
      note: note || undefined,
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white sm:rounded-card rounded-t-3xl max-h-[90vh] overflow-auto">
        {product.imageUrl && (
          <img src={product.imageUrl} alt="" className="w-full h-48 object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{product.name}</h2>
              <p className="text-sm text-mute mt-1">{product.description}</p>
            </div>
            <button onClick={onClose} className="text-mute text-2xl">
              ✕
            </button>
          </div>

          {product.variants.length > 0 && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                {product.variants[0].groupName}
              </div>
              <div className="space-y-1.5 mt-2">
                {product.variants.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center justify-between p-3 border border-line rounded-lg cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        onChange={() => setVariantId(v.id)}
                      />
                      <span className="text-sm">{v.name}</span>
                    </div>
                    <span className="text-sm text-mute">
                      {Number(v.priceDelta) > 0
                        ? `+${fmt(Number(v.priceDelta), currency)}`
                        : Number(v.priceDelta) < 0
                        ? fmt(Number(v.priceDelta), currency)
                        : ''}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {product.extras.length > 0 && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                Extras
              </div>
              <div className="space-y-1.5 mt-2">
                {product.extras.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center justify-between p-3 border border-line rounded-lg cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={extras.includes(e.id)}
                        onChange={(ev) =>
                          setExtras(
                            ev.target.checked
                              ? [...extras, e.id]
                              : extras.filter((x) => x !== e.id),
                          )
                        }
                      />
                      <span className="text-sm">{e.name}</span>
                    </div>
                    <span className="text-sm text-mute">
                      +{fmt(Number(e.price), currency)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5">
            <label className="text-xs uppercase tracking-wider text-mute font-semibold">
              Notas (opcional)
            </label>
            <input
              className="input mt-2"
              placeholder="ej: sin cebolla"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between mt-5">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty(Math.max(1, qty - 1))}
                className="w-9 h-9 rounded-full border border-line flex items-center justify-center"
              >
                −
              </button>
              <span className="text-lg font-semibold">{qty}</span>
              <button
                onClick={() => setQty(qty + 1)}
                className="w-9 h-9 rounded-full border border-line flex items-center justify-center"
              >
                +
              </button>
            </div>
            <button
              onClick={add}
              className="rounded-pill text-white font-semibold py-3 px-6"
              style={{ background: primary }}
            >
              Agregar · {fmt(total, currency)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Cart sheet
// =====================================================
function CartSheet({
  items,
  slug,
  primary,
  currency,
  onClose,
  onCheckout,
}: {
  items: CartItem[];
  slug: string;
  primary: string;
  currency: string;
  onClose: () => void;
  onCheckout: () => void;
}) {
  const totals = cartTotals(items);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl max-h-[80vh] overflow-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Tu pedido</h2>
            <button onClick={onClose} className="text-mute text-2xl">
              ✕
            </button>
          </div>

          {items.length === 0 && (
            <div className="text-center text-mute py-12">Tu carrito está vacío.</div>
          )}

          <div className="space-y-3">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line2 pb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{it.name}</div>
                  {it.extras.length > 0 && (
                    <div className="text-xs text-mute">
                      + {it.extras.map((e) => e.name).join(', ')}
                    </div>
                  )}
                  {it.note && (
                    <div className="text-xs text-mute italic">{it.note}</div>
                  )}
                  <div className="text-sm font-semibold mt-1">
                    {fmt(it.unitPrice * it.qty, currency)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateQty(slug, i, it.qty - 1)}
                    className="w-7 h-7 rounded-full border border-line flex items-center justify-center text-sm"
                  >
                    −
                  </button>
                  <span className="text-sm w-5 text-center">{it.qty}</span>
                  <button
                    onClick={() => updateQty(slug, i, it.qty + 1)}
                    className="w-7 h-7 rounded-full border border-line flex items-center justify-center text-sm"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <>
              <div className="mt-4 flex items-center justify-between font-semibold">
                <span>Total</span>
                <span className="text-lg">{fmt(totals.subtotal, currency)}</span>
              </div>
              <button
                onClick={onCheckout}
                className="w-full rounded-pill text-white font-semibold py-3.5 mt-5"
                style={{ background: primary }}
              >
                Finalizar pedido por WhatsApp
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Checkout sheet
// =====================================================
function CheckoutSheet({
  items,
  slug,
  primary,
  currency,
  onClose,
}: {
  items: CartItem[];
  slug: string;
  primary: string;
  currency: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    email: '',
    fulfillment: 'PICKUP' as 'PICKUP' | 'DINE_IN' | 'DELIVERY',
    tableNumber: '',
    customerNote: '',
    paymentMethod: 'CASH_ON_DELIVERY' as
      | 'CASH_ON_DELIVERY'
      | 'STUB'
      | 'STRIPE'
      | 'MERCADO_PAGO'
      | 'WOMPI'
      | 'PSE',
  });
  const [methods, setMethods] = useState<
    { method: string; label: string; ready: boolean }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/public/payments/methods`)
      .then((r) => r.json())
      .then(setMethods)
      .catch(() => null);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: slug,
          customer: {
            fullName: form.fullName,
            phone: form.phone,
            email: form.email || undefined,
          },
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            extraIds: i.extraIds,
            qty: i.qty,
            note: i.note,
          })),
          fulfillment: form.fulfillment,
          tableNumber: form.tableNumber || undefined,
          customerNote: form.customerNote || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'No se pudo enviar el pedido');
      }
      const order = await res.json();
      clearCart(slug);

      // Si el cliente eligió pago en línea, iniciar la sesión y redirigir al gateway
      if (form.paymentMethod !== 'CASH_ON_DELIVERY') {
        try {
          const payRes = await fetch(
            `${API}/api/public/payments/start/${order.code}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ method: form.paymentMethod }),
            },
          );
          if (!payRes.ok) {
            const j = await payRes.json().catch(() => ({}));
            throw new Error(j.message ?? 'No se pudo iniciar el pago');
          }
          const pay = await payRes.json();
          window.location.href = pay.paymentUrl;
          return;
        } catch (e: any) {
          // Si el gateway falla, igual abrimos WA como fallback
          alert(`Pago no disponible: ${e.message}\nContinuamos por WhatsApp.`);
        }
      }

      // Pago contra entrega o fallback: abrir WhatsApp
      if (order.whatsappLink) {
        window.location.href = order.whatsappLink;
        setTimeout(() => {
          window.location.href = `/o/${order.code}`;
        }, 800);
      } else {
        window.location.href = `/o/${order.code}`;
      }
    } catch (e: any) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl max-h-[90vh] overflow-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Tus datos</h2>
            <button onClick={onClose} className="text-mute text-2xl">
              ✕
            </button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">¿Cómo te llamas?</label>
              <input
                className="input"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input
                className="input"
                placeholder="+57 ..."
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="label">¿Es para...?</label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { v: 'PICKUP', l: '🥡 Llevar' },
                    { v: 'DINE_IN', l: '🍽 Mesa' },
                    { v: 'DELIVERY', l: '🛵 Domicilio' },
                  ] as const
                ).map((o) => (
                  <button
                    type="button"
                    key={o.v}
                    onClick={() => setForm({ ...form, fulfillment: o.v })}
                    className={`py-2.5 rounded-lg text-sm border ${
                      form.fulfillment === o.v
                        ? 'text-white border-transparent'
                        : 'border-line text-ink'
                    }`}
                    style={
                      form.fulfillment === o.v
                        ? { background: primary }
                        : undefined
                    }
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            {form.fulfillment === 'DINE_IN' && (
              <div>
                <label className="label">Número de mesa</label>
                <input
                  className="input"
                  value={form.tableNumber}
                  onChange={(e) =>
                    setForm({ ...form, tableNumber: e.target.value })
                  }
                />
              </div>
            )}
            <div>
              <label className="label">Notas (opcional)</label>
              <textarea
                className="input"
                value={form.customerNote}
                onChange={(e) =>
                  setForm({ ...form, customerNote: e.target.value })
                }
              />
            </div>

            <div>
              <label className="label">¿Cómo quieres pagar?</label>
              <div className="space-y-2">
                {methods
                  .filter((m) => m.ready)
                  .map((m) => (
                    <label
                      key={m.method}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${
                        form.paymentMethod === m.method
                          ? 'border-brand bg-brand-soft'
                          : 'border-line'
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={form.paymentMethod === m.method}
                        onChange={() =>
                          setForm({ ...form, paymentMethod: m.method as any })
                        }
                        className="accent-brand"
                      />
                      <span className="text-sm flex-1">{m.label}</span>
                      {m.method === 'STUB' && (
                        <span className="badge badge-warn text-[10px]">demo</span>
                      )}
                    </label>
                  ))}
              </div>
              {methods.some((m) => !m.ready) && (
                <div className="text-[10px] text-mute mt-1">
                  Más opciones de pago disponibles cuando configures Stripe / MP /
                  Wompi.
                </div>
              )}
            </div>

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-pill text-white font-semibold py-3.5 disabled:opacity-50"
              style={{ background: primary }}
            >
              {submitting
                ? 'Enviando…'
                : form.paymentMethod === 'CASH_ON_DELIVERY'
                ? 'Enviar pedido por WhatsApp'
                : 'Continuar al pago'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
