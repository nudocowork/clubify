import { headers } from 'next/headers';
import type { AuthBrand } from '@/components/AuthBrand';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type ServerBrand = {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  /** Color propio del fondo del sidebar del panel (null = derivar del acento). */
  backgroundColor: string | null;
  slug: string;
} | null;

// Última marca conocida por host/slug (sin expiración, por instancia). Regla
// dura: un dominio de marca blanca NUNCA debe renderizar el branding de Clubify
// por un fallo del backend/DB (bug outage 2026-08-14). Si el fetch falla, se
// devuelve la última marca resuelta para ese host, no null (=Clubify).
const lastKnownBrandByHost = new Map<string, ServerBrand>();
const lastKnownBrandBySlug = new Map<string, ServerBrand>();

/** Resuelve la marca blanca por host (dominio propio). null = Clubify/dev.
 *  Server-only (usa fetch con revalidate). Cacheado 60s por el fetch cache. */
export async function resolveBrandForHost(host: string): Promise<ServerBrand> {
  const h = (host || '').toLowerCase().split(':')[0];
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(h)}`,
      { cache: 'no-store' },
    );
    // Fallo del backend: NUNCA Clubify en un host de marca → última conocida.
    if (!r.ok) return lastKnownBrandByHost.get(h) ?? null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const favicon = d.faviconUrl ?? d.iconUrl ?? d.logoUrl ?? null;
    const brand: ServerBrand = {
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      faviconUrl: favicon,
      primaryColor: d.primaryColor || '#111827',
      backgroundColor: d.backgroundColor ?? null,
      slug: d.slug,
    };
    lastKnownBrandByHost.set(h, brand);
    return brand;
  } catch {
    return lastKnownBrandByHost.get(h) ?? null;
  }
}

/** Resuelve la marca por slug (ej. acceso por path /admin/<slug> sin dominio
 *  propio). null = clubify/desconocido. Server-only. */
export async function resolveBrandBySlug(slug: string): Promise<ServerBrand> {
  const s = (slug || '').trim().toLowerCase();
  if (!s || s === 'clubify') return null;
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding?slug=${encodeURIComponent(s)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) return lastKnownBrandBySlug.get(s) ?? null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const favicon = d.faviconUrl ?? d.iconUrl ?? d.logoUrl ?? null;
    const brand: ServerBrand = {
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      faviconUrl: favicon,
      primaryColor: d.primaryColor || '#111827',
      backgroundColor: d.backgroundColor ?? null,
      slug: d.slug,
    };
    lastKnownBrandBySlug.set(s, brand);
    return brand;
  } catch {
    return lastKnownBrandBySlug.get(s) ?? null;
  }
}

/** Resuelve la marca desde los headers de la request actual (host). */
export async function resolveBrandFromHeaders(): Promise<ServerBrand> {
  const host = headers().get('host') ?? '';
  return resolveBrandForHost(host);
}

// Última marca de AUTH conocida por host — misma regla dura (nunca Clubify).
const lastKnownAuthBrandByHost = new Map<string, NonNullable<AuthBrand>>();

/** Resuelve la marca de las pantallas de AUTH (login/registro/recuperar) para
 *  SEMBRARLA en el SSR (sin parpadeo de Clubify). Forma = AuthBrand del cliente.
 *  null = Clubify/dev (→ logo Clubify default). soyfidelity = Fidelity. */
export async function resolveAuthBrandForHost(host: string): Promise<AuthBrand> {
  const h = (host || '').toLowerCase().split(':')[0];
  if (h === 'soyfidelity.com' || h === 'www.soyfidelity.com') {
    return {
      slug: 'fidelity',
      name: 'Fidelity',
      logoUrl: null,
      iconUrl: null,
      faviconUrl: null,
      primaryColor: '#2563EB',
      secondaryColor: null,
    };
  }
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(h)}`,
      { cache: 'no-store' },
    );
    // Fallo del backend: última marca conocida, NUNCA Clubify.
    if (!r.ok) return lastKnownAuthBrandByHost.get(h) ?? null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const brand: NonNullable<AuthBrand> = {
      slug: d.slug,
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      iconUrl: d.iconUrl ?? null,
      faviconUrl: d.faviconUrl ?? null,
      primaryColor: d.primaryColor || '#16a34a',
      secondaryColor: d.secondaryColor ?? null,
    };
    lastKnownAuthBrandByHost.set(h, brand);
    return brand;
  } catch {
    return lastKnownAuthBrandByHost.get(h) ?? null;
  }
}

/** Igual que arriba pero desde los headers de la request. */
export async function resolveAuthBrandFromHeaders(): Promise<AuthBrand> {
  return resolveAuthBrandForHost(headers().get('host') ?? '');
}

/** Resuelve la marca por host y, si no matchea (dominio Clubify), cae al slug
 *  del header `x-wl-slug` que setea el middleware en /admin/<slug>. Cubre las
 *  marcas sin dominio propio conectado todavía. */
export async function resolveBrandFromHeadersOrSlug(): Promise<ServerBrand> {
  const h = headers();
  const byHost = await resolveBrandForHost(h.get('host') ?? '');
  if (byHost) return byHost;
  const slug = h.get('x-wl-slug');
  return slug ? resolveBrandBySlug(slug) : null;
}
