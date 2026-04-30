'use client';
// Carrito en localStorage por tenant slug

export type CartItem = {
  productId: string;
  variantId?: string;
  variantName?: string;
  extraIds: string[];
  extras: { id: string; name: string; price: number }[];
  qty: number;
  name: string;
  unitPrice: number;
  note?: string;
};

const KEY = (slug: string) => `clubify_cart_${slug}`;

export function readCart(slug: string): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY(slug)) || '[]');
  } catch {
    return [];
  }
}

export function writeCart(slug: string, items: CartItem[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY(slug), JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(`cart:${slug}`));
}

export function clearCart(slug: string) {
  writeCart(slug, []);
}

export function addToCart(slug: string, item: CartItem) {
  const items = readCart(slug);
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
  writeCart(slug, items);
}

export function updateQty(slug: string, idx: number, qty: number) {
  const items = readCart(slug);
  if (qty <= 0) {
    items.splice(idx, 1);
  } else {
    items[idx].qty = qty;
  }
  writeCart(slug, items);
}

export function cartTotals(items: CartItem[]) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const count = items.reduce((s, i) => s + i.qty, 0);
  return { subtotal, count };
}
