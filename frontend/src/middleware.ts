import { NextRequest, NextResponse } from 'next/server';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

// Hosts que no deben hacer rewrite por dominio custom (panel, dev, etc.)
const RESERVED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'app.soyclubify.com',
  'admin.soyclubify.com',
  'api.soyclubify.com',
  'soyclubify.com',
  'www.soyclubify.com',
  'app.clubify.app',
  'admin.clubify.app',
  'api.clubify.app',
]);

// Dominios raíz de Clubify donde *.<root> son subdominios de tenants.
// nudo-cowork.soyclubify.com → tenant slug "nudo-cowork"
const CLUBIFY_ROOTS = ['soyclubify.com', 'clubify.app'];

// Subdominios reservados por Clubify (no son tenants)
const RESERVED_SUBS = new Set([
  '',
  'www',
  'app',
  'api',
  'admin',
  'docs',
  'help',
  'status',
  'mail',
  'cdn',
  'assets',
]);

/**
 * Si el host es <sub>.soyclubify.com (o .clubify.app), devuelve <sub>
 * (potencial slug del tenant). null si es root o subdominio reservado.
 */
function getTenantSubdomain(host: string): string | null {
  for (const root of CLUBIFY_ROOTS) {
    if (host.endsWith('.' + root)) {
      const sub = host.slice(0, -('.' + root).length).trim();
      if (sub && !RESERVED_SUBS.has(sub) && !sub.includes('.')) {
        return sub;
      }
    }
  }
  return null;
}

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
    url.pathname.startsWith('/signup') ||
    url.pathname.startsWith('/forgot') ||
    url.pathname.startsWith('/reset') ||
    url.pathname.startsWith('/scan') ||
    url.pathname.startsWith('/onboarding') ||
    url.pathname.startsWith('/m/') ||
    url.pathname.startsWith('/i/') ||
    url.pathname.startsWith('/o/') ||
    url.pathname.startsWith('/w/') ||
    url.pathname.startsWith('/c/') ||
    url.pathname.startsWith('/q/') ||
    url.pathname.startsWith('/ref/') ||
    url.pathname.startsWith('/refer') ||
    url.pathname.startsWith('/affiliate') ||
    url.pathname.startsWith('/preview/') ||
    url.pathname.startsWith('/manifest') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname.startsWith('/sw.js')
  ) {
    return NextResponse.next();
  }

  // 1. Subdominios de Clubify: <slug>.soyclubify.com → /m/<slug>
  // No requiere DB lookup (el slug viene del subdominio directamente).
  // Si el tenant no existe, /m/<slug> renderiza 404 desde su server component.
  const subSlug = getTenantSubdomain(host);
  if (subSlug) {
    const rewrite = url.clone();
    if (url.pathname === '/' || url.pathname === '') {
      // Raíz → menú principal del tenant
      rewrite.pathname = `/m/${subSlug}`;
    } else {
      // Cualquier otra ruta /xxx → infolink del tenant
      // Ej: nudo-cowork.soyclubify.com/eventos → /i/nudo-cowork/eventos
      // Las rutas del sistema (/app, /scan, etc.) ya fueron filtradas arriba.
      const linkSlug = url.pathname.replace(/^\/+/, '').split('/')[0];
      if (linkSlug) {
        rewrite.pathname = `/i/${subSlug}/${linkSlug}`;
      } else {
        rewrite.pathname = `/m/${subSlug}`;
      }
    }
    return NextResponse.rewrite(rewrite);
  }

  // 2. Custom domains via Storefront.customDomain (CNAME tipo mibarra.com)
  const slug = await resolveHost(host);
  if (!slug) return NextResponse.next();

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
