'use client';
// Carrito en localStorage por tenant slug + canal (mesa/delivery).
//
// 2026-06-06: con la separación mesa vs delivery del item 1, el carrito
// se separa por canal — si agregás items en mesa y abrís delivery, ves
// un carrito limpio. Sin esto, items con disponibilidad parcial leakean
// entre menús.

export type CartItem = {
  productId: string;
  variantId?: string;
  /**
   * Variantes marcadas cuando el producto permite varias
   * (`maxVariantsTotal >= 2`). Solo se guarda si hay mas de una: un pedido
   * normal de una sola variante conserva la forma de siempre.
   */
  variantIds?: string[];
  variantName?: string;
  extraIds: string[];
  extras: { id: string; name: string; price: number }[];
  qty: number;
  name: string;
  unitPrice: number;
  note?: string;
};

export type CartMode = 'mesa' | 'delivery';

const KEY = (slug: string, mode: CartMode = 'mesa') =>
  `clubify_cart_${slug}__${mode}`;

// Migración silenciosa de carritos pre-2026-06-06 (clave sin sufijo de
// modo). Si existe, lo movemos al cubo mesa (el comportamiento implícito
// de la versión anterior era "todo en uno" — mesa es el default seguro).
function migrateLegacyKey(slug: string, target: CartMode) {
  if (typeof window === 'undefined') return;
  const legacy = `clubify_cart_${slug}`;
  try {
    const raw = localStorage.getItem(legacy);
    if (raw && target === 'mesa' && !localStorage.getItem(KEY(slug, 'mesa'))) {
      localStorage.setItem(KEY(slug, 'mesa'), raw);
    }
    localStorage.removeItem(legacy);
  } catch {}
}

export function readCart(slug: string, mode: CartMode = 'mesa'): CartItem[] {
  if (typeof window === 'undefined') return [];
  migrateLegacyKey(slug, mode);
  try {
    return JSON.parse(localStorage.getItem(KEY(slug, mode)) || '[]');
  } catch {
    return [];
  }
}

export function writeCart(
  slug: string,
  items: CartItem[],
  mode: CartMode = 'mesa',
) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY(slug, mode), JSON.stringify(items));
  // Evento sigue siendo per-slug — los listeners filtran internamente por
  // el modo activo si necesitan.
  window.dispatchEvent(new CustomEvent(`cart:${slug}`));
}

export function clearCart(slug: string, mode: CartMode = 'mesa') {
  writeCart(slug, [], mode);
}

export function addToCart(slug: string, item: CartItem, mode: CartMode = 'mesa') {
  const items = readCart(slug, mode);
  // Misma combinación: producto+variante+extras → suma qty
  const sig = `${item.productId}|${item.variantId ?? ''}|${item.extraIds.sort().join(',')}`;
  const existing = items.findIndex(
    (i) =>
      `${i.productId}|${i.variantId ?? ''}|${i.extraIds.sort().join(',')}` === sig,
  );
  if (existing >= 0) {
    items[existing].qty += item.qty;
  } else {
    items.push(item);
  }
  writeCart(slug, items, mode);
}

export function updateQty(
  slug: string,
  idx: number,
  qty: number,
  mode: CartMode = 'mesa',
) {
  const items = readCart(slug, mode);
  if (qty <= 0) {
    items.splice(idx, 1);
  } else {
    items[idx].qty = qty;
  }
  writeCart(slug, items, mode);
}

export function cartTotals(items: CartItem[]) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const count = items.reduce((s, i) => s + i.qty, 0);
  return { subtotal, count };
}
