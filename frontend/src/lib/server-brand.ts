import { headers } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

export type ServerBrand = {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  slug: string;
} | null;

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
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || !d.slug || d.slug === 'clubify') return null;
    const favicon = d.faviconUrl ?? d.iconUrl ?? d.logoUrl ?? null;
    return {
      name: d.name,
      logoUrl: d.logoUrl ?? null,
      faviconUrl: favicon,
      primaryColor: d.primaryColor || '#111827',
      slug: d.slug,
    };
  } catch {
    return null;
  }
}

/** Resuelve la marca desde los headers de la request actual (host). */
export async function resolveBrandFromHeaders(): Promise<ServerBrand> {
  const host = headers().get('host') ?? '';
  return resolveBrandForHost(host);
}
