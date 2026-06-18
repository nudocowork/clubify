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

// Subrutas REALES del panel /admin (carpetas en app/admin). Si el primer
// segmento tras /admin es una de estas, NO es un slug de marca → no se
// reescribe. Cualquier otro primer segmento se trata como slug de marca
// blanca: /admin/sellea sirve el mismo panel con la URL por marca.
const RESERVED_ADMIN_ROUTES = new Set([
  'accounting',
  'affiliate-registration',
  'ai-knowledge',
  'audit',
  'branding',
  'business-categories',
  'commissions',
  'industries',
  'integrations',
  'lab',
  'maintenance',
  'map',
  'payouts',
  'rankings',
  'referrals',
  'reports',
  'sales-leaderboard',
  'sales-teams',
  'support-materials',
  'tenants',
  'trials',
  'users',
  'ventas',
]);

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

// Cache aparte para el flag de mantenimiento. TTL menor (30s) porque el
// flag es más sensible a la latencia — cuando el SUPER_ADMIN apaga, la
// vuelta a normal debe ser rápida.
let maintenanceCache: {
  enabled: boolean;
  expiresAt: number;
} | null = null;
const MAINTENANCE_TTL_MS = 30_000;

async function isMaintenanceEnabled(): Promise<boolean> {
  const now = Date.now();
  if (maintenanceCache && maintenanceCache.expiresAt > now) {
    return maintenanceCache.enabled;
  }
  try {
    const r = await fetch(`${API}/api/public/maintenance/status`, {
      cache: 'no-store',
    });
    if (!r.ok) {
      maintenanceCache = { enabled: false, expiresAt: now + MAINTENANCE_TTL_MS };
      return false;
    }
    const j = (await r.json()) as { enabled?: boolean };
    const enabled = j?.enabled === true;
    maintenanceCache = { enabled, expiresAt: now + MAINTENANCE_TTL_MS };
    return enabled;
  } catch {
    // Si el backend está caído, NO mostrar página de mantenimiento —
    // sino un bug del backend rompe el sitio. Fail-open.
    return false;
  }
}

/** Decodifica el payload del JWT sin verificar firma — solo para leer
 *  el role en el middleware edge. La verificación criptográfica corre
 *  en el backend; aquí solo decidimos qué UI mostrar. Un usuario que
 *  fragua role=SUPER_ADMIN en el cookie igual NO accede a nada porque
 *  el backend rechaza el JWT inválido. */
function decodeJwtRole(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '=='.slice(0, (4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    const payload = JSON.parse(json);
    return typeof payload?.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

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

  // ────────── Panel de marca blanca por path: /admin/<slug> ──────────
  // /admin/<slug> y /admin/<slug>/<resto> sirven el MISMO panel /admin (y sus
  // subrutas) con la URL bonita por marca. Solo aplica si <slug> NO es una
  // subruta real de /admin. El branding lo resuelve el cliente desde la pila
  // de impersonación. /admin (sin slug) = Clubify, sin cambios.
  const adminBrand = url.pathname.match(/^\/admin\/([^/]+)(\/.*)?$/);
  if (adminBrand && !RESERVED_ADMIN_ROUTES.has(adminBrand[1])) {
    const rest = adminBrand[2] ?? '';
    const rewrite = url.clone();
    rewrite.pathname = `/admin${rest}`;
    return NextResponse.rewrite(rewrite);
  }

  // ────────── Maintenance mode ──────────
  // Si el flag global está activo, rewriteamos TODO el tráfico web a
  // /maintenance EXCEPTO:
  //  - SUPER_ADMIN (cookie con role en JWT) — para que pueda apagar el flag.
  //  - El panel /admin (para que SUPER_ADMIN pueda loguearse y entrar).
  //  - /login (para que SUPER_ADMIN pueda autenticarse).
  //  - La propia página /maintenance (sino loop infinito de rewrite).
  //  - Activos estáticos (/_next, /icons, /favicon, /sw.js).
  //  - El backend NO se rutea por aquí, no afecta.
  const isMaintenanceBypass =
    url.pathname === '/maintenance' ||
    url.pathname.startsWith('/_next') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/favicon') ||
    url.pathname === '/sw.js' ||
    url.pathname.startsWith('/admin') ||
    url.pathname === '/login' ||
    url.pathname.startsWith('/manifest');

  if (!isMaintenanceBypass) {
    const enabled = await isMaintenanceEnabled();
    if (enabled) {
      const token = req.cookies.get('clubify_token')?.value;
      const role = decodeJwtRole(token);
      if (role !== 'SUPER_ADMIN') {
        const rewrite = url.clone();
        rewrite.pathname = '/maintenance';
        return NextResponse.rewrite(rewrite);
      }
    }
  }

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
    url.pathname.startsWith('/activar') ||
    url.pathname.startsWith('/forgot') ||
    url.pathname.startsWith('/reset') ||
    url.pathname.startsWith('/scan') ||
    url.pathname.startsWith('/onboarding') ||
    url.pathname === '/maintenance' ||
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
