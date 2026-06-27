import { headers } from 'next/headers';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type BrandManifestInfo = {
  name: string;
  primaryColor: string;
  slug: string;
  version: number;
};

function toBrandInfo(d: any): BrandManifestInfo | null {
  if (!d || !d.slug || d.slug === 'clubify') return null;
  return {
    name: d.name,
    primaryColor: d.primaryColor || '#111827',
    slug: d.slug,
    version: Number(d.brandingVersion) || 0,
  };
}

/** Resuelve la marca blanca por host. null para Clubify/dev. */
async function resolveBrandByHost(host: string): Promise<BrandManifestInfo | null> {
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
    return toBrandInfo(await r.json());
  } catch {
    return null;
  }
}

/** Resuelve la marca blanca por slug (acceso por /admin/<slug> en dominio
 *  Clubify, donde el middleware setea el header x-wl-slug). null = clubify. */
async function resolveBrandBySlug(slug: string): Promise<BrandManifestInfo | null> {
  const s = (slug || '').trim().toLowerCase();
  if (!s || s === 'clubify') return null;
  try {
    const r = await fetch(
      `${API_URL}/api/superadmin-public/white-labels/branding?slug=${encodeURIComponent(s)}`,
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    return toBrandInfo(await r.json());
  } catch {
    return null;
  }
}

/** URL del icono generado al vuelo por el backend (cualquier tamaño/propósito),
 *  con cache-bust por versión de branding. */
function brandIconUrl(
  slug: string,
  size: number,
  purpose: 'any' | 'maskable',
  version: number,
): string {
  return `${API_URL}/api/superadmin-public/white-labels/icon?slug=${encodeURIComponent(slug)}&size=${size}&purpose=${purpose}&v=${version}`;
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
// Lee headers de la request → debe ser dinámico para resolver por host/slug.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const h = headers();
  const host = h.get('host') ?? '';
  // Slug de marca (acceso por /admin/<slug> en dominio Clubify, sin dominio
  // propio conectado). El documento que pide este manifest lo referencia como
  // /manifest.webmanifest?slug=<slug> (ver layout.tsx); también aceptamos el
  // header x-wl-slug que setea el middleware por si la request lo arrastra.
  const slugParam = new URL(req.url).searchParams.get('slug') ?? '';
  const slug = slugParam || h.get('x-wl-slug') || '';
  // 1) Marca por dominio propio (host). 2) Si no, por slug → los iconos del
  //    manifest son los de la marca y no caen al estático de Clubify (404/403).
  const brand =
    (await resolveBrandByHost(host)) || (await resolveBrandBySlug(slug));

  if (!brand) {
    return Response.json(CLUBIFY_MANIFEST, {
      headers: { 'Content-Type': 'application/manifest+json' },
    });
  }

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
    // Variantes generadas al vuelo desde el icono de la marca: 192/512 estándar
    // + 512 maskable (Android recorta a círculo/squircle con zona segura).
    icons: [
      {
        src: brandIconUrl(brand.slug, 192, 'any', brand.version),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: brandIconUrl(brand.slug, 512, 'any', brand.version),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: brandIconUrl(brand.slug, 512, 'maskable', brand.version),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
