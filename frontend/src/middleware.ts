import { NextRequest, NextResponse } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

// Hosts que no deben hacer rewrite por dominio custom (panel, dev, etc.)
const RESERVED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'app.clubify.app',
  'admin.clubify.app',
  'api.clubify.app',
]);

// Cache simple en memoria (proceso edge per-instance) para evitar pegarle al backend en cada request.
const cache = new Map<string, { slug: string | null; until: number }>();
const TTL_MS = 60_000;

async function resolveHost(host: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.until > now) return hit.slug;
  try {
    const r = await fetch(
      `${API}/api/public/storefront/resolve-host?host=${encodeURIComponent(host)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) {
      cache.set(host, { slug: null, until: now + TTL_MS });
      return null;
    }
    const j = (await r.json()) as { slug?: string | null };
    const slug = j?.slug ?? null;
    cache.set(host, { slug, until: now + TTL_MS });
    return slug;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];

  // Salir rápido si: host reservado, ruta de API/Next, ruta del panel
  if (
    !host ||
    RESERVED_HOSTS.has(host) ||
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/app') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/scan') ||
    url.pathname.startsWith('/onboarding') ||
    url.pathname.startsWith('/m/') ||
    url.pathname.startsWith('/i/') ||
    url.pathname.startsWith('/o/') ||
    url.pathname.startsWith('/pay/') ||
    url.pathname.startsWith('/manifest') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname.startsWith('/sw.js')
  ) {
    return NextResponse.next();
  }

  const slug = await resolveHost(host);
  if (!slug) return NextResponse.next();

  // Rewrite raíz al storefront del tenant
  if (url.pathname === '/') {
    const rewrite = url.clone();
    rewrite.pathname = `/m/${slug}`;
    return NextResponse.rewrite(rewrite);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.png).*)'],
};
