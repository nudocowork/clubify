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
import { Barcode } from '@/components/Barcode';
import { ClubifyBadge } from '@/components/ClubifyBadge';
import { CO_LOCATIONS, OTRO_MUNICIPIO } from '@/lib/co-locations';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type MenuLayout = 'CLASSIC' | 'GRID' | 'CAROUSELS' | 'CLEAN' | 'COMPACT';

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
  menuLayout?: MenuLayout;
  planName?: string | null;
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
  const [tab, setTab] = useState<'menu' | 'promos'>('menu');
  const [openProduct, setOpenProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    fetch(`${API}/api/public/m/${slug}`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.message ?? 'No disponible');
        }
        return r.json();
      })
      .then(setS)
      .catch((e: Error) => setLoadError(e.message || 'No disponible'));
    fetch(`${API}/api/public/m/${slug}/menu`)
      .then(async (r) => (r.ok ? r.json() : []))
      .then(setMenu)
      .catch(() => setMenu([]));
    setCart(readCart(slug));
    const handler = () => setCart(readCart(slug));
    window.addEventListener(`cart:${slug}`, handler);
    return () => window.removeEventListener(`cart:${slug}`, handler);
  }, [slug]);

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-bg">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">😔</div>
          <h1 className="text-xl font-bold">Negocio no disponible</h1>
          <p className="text-mute mt-2 text-sm leading-relaxed">
            {loadError === 'No disponible' ||
            loadError === 'Negocio no disponible'
              ? 'Esta tienda no está activa en este momento. Contacta directamente al negocio o intenta de nuevo más tarde.'
              : loadError}
          </p>
        </div>
      </div>
    );
  }
  if (!s) return <div className="p-8 text-mute">Cargando…</div>;

  const totals = cartTotals(cart);
  const primary = s.primaryColor;

  return (
    <div
      className="min-h-screen pb-32"
      style={{ background: '#FAFBFC' }}
    >
      {/* Hero */}
      <header className="relative">
        {/* Backdrop: heroImage o gradient brand */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: s.heroImageUrl
              ? `linear-gradient(180deg, rgba(0,0,0,.05) 0%, rgba(255,255,255,.95) 70%, #FAFBFC 100%), url(${s.heroImageUrl}) center/cover`
              : `linear-gradient(135deg, ${primary}15, ${s.secondaryColor}15, transparent)`,
          }}
        />
        <div className="px-5 pt-10 pb-6 max-w-2xl mx-auto">
          <div className="flex items-center gap-3.5">
            {s.logoUrl ? (
              <img
                src={s.logoUrl}
                alt=""
                className="w-14 h-14 rounded-2xl ring-4 ring-white shadow-sm object-cover"
              />
            ) : (
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl ring-4 ring-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${primary}, ${s.secondaryColor})` }}
              >
                {s.brandName[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-2xl tracking-tight truncate">{s.brandName}</div>
              {s.description && (
                <div className="text-sm text-mute truncate">{s.description}</div>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap mt-4">
            {s.whatsappPhone && (
              <a
                href={`https://wa.me/${s.whatsappPhone.replace(/\D/g, '')}`}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-white text-sm font-semibold shadow-sm hover:opacity-90 transition"
                style={{ background: '#25D366' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.711.306 1.265.489 1.697.626.713.226 1.362.194 1.875.118.572-.085 1.758-.719 2.006-1.413.247-.694.247-1.289.173-1.413z"/></svg>
                WhatsApp
              </a>
            )}
            {s.instagramUrl && (
              <a
                href={s.instagramUrl}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur border border-line text-sm font-medium hover:bg-white transition"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                Instagram
              </a>
            )}
            {s.mapsUrl && (
              <a
                href={s.mapsUrl}
                target="_blank"
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/90 backdrop-blur border border-line text-sm font-medium hover:bg-white transition"
              >
                <Icon name="pin" size={14} /> Cómo llegar
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="px-5 max-w-2xl mx-auto sticky top-2 z-20">
        <div className="flex gap-1 p-1 rounded-pill bg-white border border-line shadow-sm">
          {(['menu', 'promos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-pill text-sm font-medium transition"
              style={{
                background: tab === t ? primary : 'transparent',
                color: tab === t ? '#fff' : '#6B7280',
              }}
            >
              {t === 'menu' ? 'Menú' : 'Promociones'}
            </button>
          ))}
        </div>
      </div>

      {/* Menú */}
      {tab === 'menu' && (
        <div className="max-w-2xl mx-auto mt-4 px-5">
          {menu.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">📋</div>
              <div className="font-semibold text-lg">Pronto publicamos el menú</div>
              <div className="text-sm text-mute mt-1 max-w-xs mx-auto">
                Mientras tanto, escríbenos por WhatsApp para hacer tu pedido.
              </div>
              {s.whatsappPhone && (
                <a
                  href={`https://wa.me/${s.whatsappPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-pill text-white font-semibold text-sm"
                  style={{ background: '#25D366' }}
                >
                  Hablar por WhatsApp →
                </a>
              )}
            </div>
          )}
          <MenuRenderer
            layout={s.menuLayout ?? 'CLASSIC'}
            menu={menu}
            primary={primary}
            currency={s.currency}
            onPick={setOpenProduct}
          />
        </div>
      )}

      {/* Promos */}
      {tab === 'promos' && (
        <div className="max-w-2xl mx-auto mt-4 px-5 space-y-3">
          {s.promotions.length === 0 && (
            <div className="text-center py-16">
              <div className="text-5xl mb-3">🎁</div>
              <div className="font-semibold text-lg">No hay promos activas</div>
              <div className="text-sm text-mute mt-1">
                Vuelve pronto, siempre estamos lanzando algo nuevo.
              </div>
            </div>
          )}
          {s.promotions.map((p) => {
            const wa = s.whatsappPhone?.replace(/\D/g, '');
            const orderHref = wa
              ? `https://wa.me/${wa}?text=${encodeURIComponent(
                  `Hola! Quiero ordenar esta promoción: ${p.name}`,
                )}`
              : null;
            return (
              <div
                key={p.id}
                className="rounded-card overflow-hidden bg-white border border-line shadow-sm"
              >
                {p.imageUrl && (
                  <div className="relative aspect-[16/9] bg-bg2">
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                    <span
                      className="absolute top-3 left-3 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded text-white shadow"
                      style={{ background: primary }}
                    >
                      🎁 Promo
                    </span>
                  </div>
                )}
                <div className="p-4">
                  {!p.imageUrl && (
                    <div
                      className="text-[10px] uppercase tracking-wider font-bold mb-2 inline-block px-2 py-1 rounded text-white"
                      style={{ background: primary }}
                    >
                      🎁 Promo
                    </div>
                  )}
                  <div className="font-bold text-lg leading-tight">{p.name}</div>
                  {p.description && (
                    <div className="text-sm text-mute mt-1.5 leading-relaxed whitespace-pre-line">
                      {p.description}
                    </div>
                  )}
                  {(p.originalPrice || p.value) && (
                    <div className="mt-2.5 flex items-baseline gap-2">
                      {p.originalPrice && (
                        <span className="text-mute line-through text-sm">
                          {fmt(Number(p.originalPrice), s.currency)}
                        </span>
                      )}
                      {p.value > 0 && p.type === 'DISCOUNT_AMOUNT' && (
                        <span className="text-xl font-bold text-bad">
                          {fmt(Number(p.value), s.currency)}
                        </span>
                      )}
                      {p.value > 0 && p.type === 'DISCOUNT_PCT' && (
                        <span className="text-xl font-bold text-bad">
                          -{Number(p.value)}%
                        </span>
                      )}
                    </div>
                  )}
                  {p.validUntil && (
                    <div className="text-xs text-mute mt-2 flex items-center gap-1">
                      ⏰ Hasta {new Date(p.validUntil).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
                    </div>
                  )}
                  {orderHref ? (
                    <a
                      href={orderHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 block w-full text-center text-white font-semibold py-2.5 rounded-pill"
                      style={{ background: '#25D366' }}
                    >
                      💬 Ordenar esta promo por WhatsApp
                    </a>
                  ) : (
                    <button
                      onClick={() => setTab('menu')}
                      className="mt-4 block w-full text-center text-white font-semibold py-2.5 rounded-pill"
                      style={{ background: primary }}
                    >
                      Ver el menú →
                    </button>
                  )}
                </div>
              </div>
            );
          })}
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
          planName={s.planName ?? null}
          onClose={() => setShowCheckout(false)}
        />
      )}

      {/* Marca Clubify — siempre visible, no removible */}
      <ClubifyBadge />
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
  planName,
  onClose,
}: {
  items: CartItem[];
  slug: string;
  primary: string;
  currency: string;
  planName: string | null;
  onClose: () => void;
}) {
  // Si la URL trae ?mesa=N (escaneo de QR de mesa), pre-rellenamos y
  // forzamos fulfillment a DINE_IN. El número de mesa SIEMPRE viene del
  // QR — el cliente nunca lo escribe a mano.
  const tableFromQr =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('mesa') ?? ''
      : '';
  const lockedTable = tableFromQr.trim().length > 0;
  const isPro = planName === 'Pro';

  // Sin QR: no podemos servir a mesa. Sin plan Pro: no se permite domicilio.
  // PICKUP fue removido. Si no hay opciones disponibles, mostramos guidance
  // al cliente para que pida por WhatsApp en vez de hacer checkout.
  const defaultFulfillment: 'DINE_IN' | 'DELIVERY' | null = lockedTable
    ? 'DINE_IN'
    : isPro
    ? 'DELIVERY'
    : null;

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    fulfillment: (defaultFulfillment ?? 'DINE_IN') as 'DINE_IN' | 'DELIVERY',
    tableNumber: tableFromQr,
    customerNote: '',
    // Dirección de envío (solo se completa cuando fulfillment === 'DELIVERY')
    departamento: '',
    municipio: '',
    municipioOtro: '',
    direccion: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const munList =
    CO_LOCATIONS.find((d) => d.departamento === form.departamento)?.municipios ??
    [];
  const municipioFinal =
    form.municipio === OTRO_MUNICIPIO
      ? form.municipioOtro.trim()
      : form.municipio;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    // Validación adicional para delivery: dirección obligatoria
    if (form.fulfillment === 'DELIVERY') {
      if (!form.departamento || !municipioFinal || !form.direccion.trim()) {
        setErr(
          'Completa departamento, municipio y dirección para entregar a domicilio.',
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`.trim();
      const deliveryAddress =
        form.fulfillment === 'DELIVERY'
          ? {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              phone: form.phone.trim(),
              departamento: form.departamento,
              municipio: municipioFinal,
              direccion: form.direccion.trim(),
            }
          : undefined;
      const res = await fetch(`${API}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: slug,
          customer: {
            fullName,
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
          deliveryAddress,
          customerNote: form.customerNote || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'No se pudo enviar el pedido');
      }
      const order = await res.json();
      clearCart(slug);

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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Nombre</label>
                <input
                  className="input"
                  placeholder="Nombre"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm({ ...form, firstName: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label className="label">Apellido</label>
                <input
                  className="input"
                  placeholder="Apellido"
                  value={form.lastName}
                  onChange={(e) =>
                    setForm({ ...form, lastName: e.target.value })
                  }
                  required
                />
              </div>
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
            {!lockedTable && (
              <div>
                <label className="label">¿Es para...?</label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      {
                        v: 'DINE_IN' as const,
                        l: '🍽 Mesa',
                        disabled: !lockedTable,
                        hint: 'Escanea el QR de tu mesa',
                      },
                      {
                        v: 'DELIVERY' as const,
                        l: '🛵 Domicilio',
                        disabled: !isPro,
                        hint: 'Disponible en plan Pro',
                      },
                    ]
                  ).map((o) => {
                    const active = form.fulfillment === o.v;
                    return (
                      <button
                        type="button"
                        key={o.v}
                        disabled={o.disabled}
                        onClick={() =>
                          !o.disabled && setForm({ ...form, fulfillment: o.v })
                        }
                        title={o.disabled ? o.hint : undefined}
                        className={`py-2.5 rounded-lg text-sm border relative ${
                          active && !o.disabled
                            ? 'text-white border-transparent'
                            : o.disabled
                            ? 'border-line text-mute opacity-50 cursor-not-allowed bg-bg2/40'
                            : 'border-line text-ink'
                        }`}
                        style={
                          active && !o.disabled
                            ? { background: primary }
                            : undefined
                        }
                      >
                        {o.l}
                        {o.disabled && (
                          <span className="block text-[10px] text-mute font-normal mt-0.5">
                            {o.hint}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Si no hay opción válida (sin QR + sin Pro), guiamos al
                cliente al WhatsApp del negocio para que pida por ahí */}
            {!lockedTable && !isPro && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-sm text-amber-900">
                <div className="font-semibold mb-0.5">
                  📍 Para pedir desde aquí
                </div>
                <div className="text-xs">
                  Escanea el QR de tu mesa, o contáctanos por WhatsApp para
                  hacer tu pedido.
                </div>
              </div>
            )}
            {lockedTable && (
              <div className="rounded-lg bg-brand-soft text-brand-700 px-3 py-2.5 text-sm flex items-center gap-2">
                <span>📍</span>
                <span>
                  Pidiendo desde la <b>mesa {form.tableNumber}</b> · entregamos
                  a tu mesa
                </span>
              </div>
            )}

            {form.fulfillment === 'DELIVERY' && (
              <div className="rounded-lg border border-line bg-bg2/30 p-3 space-y-2.5">
                <div className="text-xs uppercase tracking-wider text-mute font-semibold">
                  📦 Dirección de envío
                </div>
                <div>
                  <label className="label">Departamento *</label>
                  <select
                    className="input"
                    value={form.departamento}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        departamento: e.target.value,
                        municipio: '',
                        municipioOtro: '',
                      })
                    }
                    required
                  >
                    <option value="">Departamento</option>
                    {CO_LOCATIONS.map((d) => (
                      <option key={d.departamento} value={d.departamento}>
                        {d.departamento}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Municipio *</label>
                  <select
                    className="input"
                    value={form.municipio}
                    onChange={(e) =>
                      setForm({ ...form, municipio: e.target.value })
                    }
                    disabled={!form.departamento}
                    required
                  >
                    <option value="">
                      {form.departamento ? 'Municipio' : 'Elige un departamento primero'}
                    </option>
                    {munList.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {form.departamento && (
                      <option value={OTRO_MUNICIPIO}>{OTRO_MUNICIPIO}…</option>
                    )}
                  </select>
                </div>
                {form.municipio === OTRO_MUNICIPIO && (
                  <div>
                    <label className="label">Nombre del municipio *</label>
                    <input
                      className="input"
                      placeholder="Escribe el nombre del municipio"
                      value={form.municipioOtro}
                      onChange={(e) =>
                        setForm({ ...form, municipioOtro: e.target.value })
                      }
                      required
                    />
                  </div>
                )}
                <div>
                  <label className="label">Dirección *</label>
                  <input
                    className="input"
                    placeholder="Ej: Calle 123 #45-67, Apto 301, Barrio…"
                    value={form.direccion}
                    onChange={(e) =>
                      setForm({ ...form, direccion: e.target.value })
                    }
                    required
                  />
                </div>
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

            {err && (
              <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || defaultFulfillment === null}
              className="w-full rounded-pill text-white font-semibold py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: primary }}
              title={
                defaultFulfillment === null
                  ? 'Escanea el QR de tu mesa para pedir desde aquí'
                  : undefined
              }
            >
              {submitting ? 'Enviando…' : 'Enviar pedido por WhatsApp'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// "Mi tarjeta" lookup
// =====================================================
type LookedUpPass = {
  id: string;
  serialNumber: string;
  stampsCount: number;
  pointsBalance: number;
  card: {
    id: string;
    name: string;
    type: 'STAMPS' | 'POINTS' | 'TIER' | 'COUPON';
    stampsRequired: number | null;
    primaryColor: string | null;
  };
  customer: { id: string; fullName: string };
};

function CardLookup({ slug, primary }: { slug: string; primary: string }) {
  const STORAGE_KEY = `clubify:lastPhone:${slug}`;
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [passes, setPasses] = useState<LookedUpPass[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    const saved =
      typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      setPhone(saved);
      runLookup(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function runLookup(p: string) {
    setLoading(true);
    setErr('');
    try {
      const r = await fetch(
        `${API}/api/passes/lookup/by-phone?slug=${encodeURIComponent(slug)}&phone=${encodeURIComponent(p)}`,
      );
      if (!r.ok) throw new Error('No pudimos consultar ahora');
      const data = await r.json();
      setPasses(data.passes ?? []);
      setSearched(true);
      if ((data.passes ?? []).length > 0) {
        try {
          localStorage.setItem(STORAGE_KEY, p);
        } catch {}
      }
    } catch (e: any) {
      setErr(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    runLookup(phone);
  }

  function changePhone() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setPasses([]);
    setSearched(false);
    setPhone('');
  }

  return (
    <div className="max-w-md mx-auto mt-6 px-5">
      {!searched || passes.length === 0 ? (
        <form onSubmit={onSubmit} className="text-center">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-3"
            style={{ background: primary + '15', color: primary }}
          >
            <Icon name="card" size={28} />
          </div>
          <h2 className="text-lg font-bold mb-1">Mi tarjeta de fidelización</h2>
          <p className="text-sm text-mute mb-4">
            Ingresa tu WhatsApp para ver tu progreso y sellos acumulados.
          </p>
          <input
            className="input mb-3 text-center"
            placeholder="+57 300 1234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            required
          />
          <button
            type="submit"
            disabled={loading || phone.replace(/\D/g, '').length < 7}
            className="btn-primary w-full justify-center disabled:opacity-50"
            style={{ background: primary, borderColor: primary }}
          >
            <Icon name="search" /> {loading ? 'Buscando…' : 'Ver mi tarjeta'}
          </button>
          {err && (
            <div className="text-sm text-bad mt-3">{err}</div>
          )}
          {searched && passes.length === 0 && !loading && !err && (
            <div className="rounded-xl bg-bg2 mt-4 p-4 text-sm text-mute">
              No encontramos tarjetas asociadas a ese número. Si todavía no
              tienes una, te llegará automáticamente con tu primer pedido.
            </div>
          )}
          <p className="text-xs text-mute mt-3">
            Tu información solo se usa para localizar tu tarjeta. No la
            compartimos.
          </p>
        </form>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-mute">
              Hola{' '}
              <span className="font-semibold text-ink">
                {passes[0].customer.fullName}
              </span>
            </div>
            <button
              onClick={changePhone}
              className="text-xs text-brand hover:underline"
            >
              Cambiar número
            </button>
          </div>
          <div className="space-y-3">
            {passes.map((p) => (
              <PassCard key={p.id} pass={p} fallbackPrimary={primary} />
            ))}
          </div>
          <p className="text-xs text-mute mt-4 text-center">
            Muestra el código en caja para acumular sellos.
          </p>
        </div>
      )}
    </div>
  );
}

function PassCard({
  pass,
  fallbackPrimary,
}: {
  pass: LookedUpPass;
  fallbackPrimary: string;
}) {
  const color = pass.card.primaryColor || fallbackPrimary;
  const required = pass.card.stampsRequired ?? 10;
  const dots = Array.from({ length: required });
  return (
    <div className="rounded-2xl shadow-card overflow-hidden bg-white">
      <div
        className="px-4 py-3 text-white flex items-center justify-between"
        style={{ background: color }}
      >
        <div>
          <div className="text-[11px] uppercase tracking-wider opacity-80">
            Tarjeta
          </div>
          <div className="font-semibold text-sm">{pass.card.name}</div>
        </div>
        {pass.card.type === 'STAMPS' && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider opacity-80">
              Sellos
            </div>
            <div className="font-bold text-lg">
              {pass.stampsCount}/{required}
            </div>
          </div>
        )}
        {pass.card.type === 'POINTS' && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wider opacity-80">
              Puntos
            </div>
            <div className="font-bold text-lg">{pass.pointsBalance}</div>
          </div>
        )}
      </div>
      {pass.card.type === 'STAMPS' && (
        <div className="px-4 py-3 flex flex-wrap gap-1.5 bg-bg2">
          {dots.map((_, i) => (
            <span
              key={i}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
              style={{
                background: i < pass.stampsCount ? color : '#fff',
                color: i < pass.stampsCount ? '#fff' : '#9CA3AF',
                border: '1.5px solid ' + (i < pass.stampsCount ? color : '#E5E7EB'),
              }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      )}
      <div className="px-4 py-3 bg-white flex flex-col items-center">
        <Barcode value={pass.serialNumber} height={60} />
        <div className="text-[10px] tracking-widest text-mute mt-1">
          {pass.serialNumber}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MenuRenderer — switch entre los 5 layouts de menú
// ============================================================
type RenderProps = {
  layout: MenuLayout;
  menu: Category[];
  primary: string;
  currency: string;
  onPick: (p: Product) => void;
};

function MenuRenderer({ layout, menu, primary, currency, onPick }: RenderProps) {
  if (layout === 'GRID')
    return <LayoutGrid menu={menu} primary={primary} currency={currency} onPick={onPick} />;
  if (layout === 'CAROUSELS')
    return <LayoutCarousels menu={menu} primary={primary} currency={currency} onPick={onPick} />;
  if (layout === 'CLEAN')
    return <LayoutClean menu={menu} primary={primary} currency={currency} onPick={onPick} />;
  if (layout === 'COMPACT')
    return <LayoutCompact menu={menu} primary={primary} currency={currency} onPick={onPick} />;
  return <LayoutClassic menu={menu} primary={primary} currency={currency} onPick={onPick} />;
}

type LP = Omit<RenderProps, 'layout'>;

// 1️⃣ CLASSIC — foto izq + info der (estilo Rappi/UberEats)
function LayoutClassic({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <section key={cat.id} className="mb-6">
          <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-3">
            {cat.name}
          </h2>
          <div className="space-y-2.5">
            {cat.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full bg-white border border-line rounded-card overflow-hidden text-left transition hover:shadow-md2 flex"
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="w-24 h-24 object-cover flex-none" />
                ) : (
                  <div className="w-24 h-24 bg-bg2 flex-none flex items-center justify-center text-2xl text-mute">
                    🍽
                  </div>
                )}
                <div className="flex-1 p-3 min-w-0">
                  <div className="font-semibold text-sm">{p.name}</div>
                  <div className="text-xs text-mute mt-0.5 line-clamp-2">{p.description}</div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="font-bold text-sm">{fmt(Number(p.basePrice), currency)}</div>
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
    </>
  );
}

// 2️⃣ GRID — 2 columnas con foto cuadrada grande (Instagram)
function LayoutGrid({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <section key={cat.id} className="mb-6">
          <h2 className="text-xs uppercase tracking-[0.18em] text-mute font-semibold mb-3">
            {cat.name}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {cat.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="text-left group"
              >
                <div className="aspect-square rounded-2xl overflow-hidden relative bg-bg2">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-mute">
                      🍽
                    </div>
                  )}
                  {p.tags[0] && (
                    <span className="absolute top-2 left-2 text-[9px] uppercase tracking-wider bg-white/95 text-ink font-bold px-1.5 py-0.5 rounded shadow-sm">
                      {p.tags[0]}
                    </span>
                  )}
                  <div
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full text-white shadow-lg text-xl flex items-center justify-center"
                    style={{ background: primary }}
                  >
                    +
                  </div>
                </div>
                <div className="mt-1.5 px-1">
                  <div className="text-sm font-semibold leading-tight line-clamp-1">{p.name}</div>
                  <div className="text-sm font-bold mt-0.5" style={{ color: primary }}>
                    {fmt(Number(p.basePrice), currency)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// 3️⃣ CAROUSELS — scroll horizontal por categoría (Netflix)
function LayoutCarousels({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.map((cat) => (
        <section key={cat.id} className="mb-7">
          <div className="flex items-baseline justify-between mb-2.5 px-1">
            <h2 className="font-bold text-base">{cat.name}</h2>
            <span className="text-xs text-mute">{cat.products.length} productos</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 snap-x snap-mandatory">
            {cat.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-[140px] flex-none text-left snap-start"
              >
                <div className="aspect-square rounded-xl overflow-hidden relative bg-bg2">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-3xl text-mute">
                      🍽
                    </div>
                  )}
                  {p.tags[0] && (
                    <span className="absolute top-1.5 left-1.5 text-[8px] uppercase tracking-wider bg-white/95 text-ink font-bold px-1 py-0.5 rounded">
                      {p.tags[0]}
                    </span>
                  )}
                </div>
                <div className="mt-1 px-0.5">
                  <div className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2.4em]">
                    {p.name}
                  </div>
                  <div className="text-sm font-bold mt-0.5" style={{ color: primary }}>
                    {fmt(Number(p.basePrice), currency)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// 4️⃣ CLEAN — sin fotos, serif elegante (boutique)
function LayoutClean({ menu, currency, onPick }: LP) {
  return (
    <div className="font-serif">
      {menu.map((cat) => (
        <section key={cat.id} className="mb-7">
          <div className="text-center mb-4">
            <div className="text-[10px] tracking-[0.3em] uppercase font-semibold text-mute mb-1.5">
              {cat.name}
            </div>
            <div className="w-12 h-px bg-ink mx-auto" />
          </div>
          <div className="space-y-4">
            {cat.products.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="block w-full text-left px-1 hover:bg-bg2/50 rounded-md py-2 transition"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-[15px] font-semibold">{p.name}</div>
                  <div className="text-sm tracking-tight">
                    {fmt(Number(p.basePrice), currency)}
                  </div>
                </div>
                {p.description && (
                  <div className="text-[12px] text-mute mt-1 italic">{p.description}</div>
                )}
                {p.tags[0] && (
                  <div className="text-[10px] uppercase tracking-wider text-brand font-bold mt-1">
                    ▸ {p.tags[0]}
                  </div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// 5️⃣ COMPACT — lista compacta + tabs sticky por categoría (DoorDash)
function LayoutCompact({ menu, primary, currency, onPick }: LP) {
  return (
    <>
      {menu.length > 1 && (
        <div className="sticky top-0 bg-white z-10 -mx-5 px-5 py-2 border-b border-line flex gap-4 overflow-x-auto text-xs font-semibold mb-3">
          {menu.map((c, i) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className={`whitespace-nowrap pb-1 ${i === 0 ? 'border-b-2 text-ink' : 'text-mute'}`}
              style={i === 0 ? { borderColor: primary } : {}}
            >
              {c.name}
            </a>
          ))}
        </div>
      )}
      {menu.map((cat) => (
        <section key={cat.id} id={`cat-${cat.id}`} className="mb-5">
          <h2 className="font-bold text-sm mt-1 mb-2">{cat.name}</h2>
          <div className="bg-white rounded-card border border-line overflow-hidden">
            {cat.products.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className={`w-full text-left px-3.5 py-3 hover:bg-bg2/50 transition ${
                  i < cat.products.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-sm flex items-center gap-1.5">
                    {p.name}
                    {p.tags[0] && (
                      <span
                        className="text-[8px] uppercase font-bold px-1 py-0.5 rounded text-white"
                        style={{ background: primary }}
                      >
                        {p.tags[0]}
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-sm whitespace-nowrap">
                    {fmt(Number(p.basePrice), currency)}
                  </div>
                </div>
                {p.description && (
                  <div className="text-[11px] text-mute mt-0.5 line-clamp-1">{p.description}</div>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
