import { headers } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/** Resuelve la marca blanca por host. null para Clubify/dev. */
async function resolveBrand(host: string): Promise<{
  name: string;
  icon: string | null;
  primaryColor: string;
  slug: string;
} | null> {
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
    // Icono PWA = favicon dedicado → icono dashboard → logo header.
    const icon = d.faviconUrl ?? d.iconUrl ?? d.logoUrl ?? null;
    return {
      name: d.name,
      icon,
      primaryColor: d.primaryColor || '#111827',
      slug: d.slug,
    };
  } catch {
    return null;
  }
}

function brandIconSvg(name: string, color: string): string {
  const initial = (name.trim()[0] ?? 'S').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><text x="32" y="45" font-size="36" font-family="Arial,Helvetica,sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const CLUBIFY_MANIFEST = {
  name: 'Clubify',
  short_name: 'Clubify',
  description:
    'El sistema operativo de tu negocio local: pedidos por WhatsApp, fidelización wallet, automatizaciones, CRM y analítica.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'portrait',
  background_color: '#0B1F14',
  theme_color: '#22C55E',
  categories: ['business', 'productivity', 'lifestyle'],
  lang: 'es',
  dir: 'ltr',
  icons: [
    { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

/**
 * Manifest PWA dinámico por host: en el dominio de una marca blanca devuelve
 * su nombre/colores/icono; en Clubify devuelve el manifest de siempre. Sin
 * referencias a Clubify en el dominio de la marca.
 */
export async function GET() {
  const host = headers().get('host') ?? '';
  const brand = await resolveBrand(host);

  if (!brand) {
    return Response.json(CLUBIFY_MANIFEST, {
      headers: { 'Content-Type': 'application/manifest+json' },
    });
  }

  const icon = brand.icon || brandIconSvg(brand.name, brand.primaryColor);
  const isImage = !!brand.icon;
  const manifest = {
    name: brand.name,
    short_name: brand.name,
    description: `${brand.name}: fideliza, vende y automatiza tu negocio en un solo lugar.`,
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: brand.primaryColor,
    categories: ['business', 'productivity'],
    lang: 'es',
    dir: 'ltr',
    icons: [
      {
        src: icon,
        sizes: 'any',
        type: isImage ? 'image/png' : 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
