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
  // Dominio dedicado del panel Super Admin (PLATFORM_OWNER).
  'soyfidelity.com',
  'www.soyfidelity.com',
]);

// Dominios raíz de Clubify donde *.<root> son subdominios de tenants.
// nudo-cowork.soyclubify.com → tenant slug "nudo-cowork"
const CLUBIFY_ROOTS = ['soyclubify.com', 'clubify.app'];

// Subrutas REALES del panel /admin (carpetas en app/admin). Si el primer
// segmento tras /admin es una de estas, NO es un slug de marca → no se
// reescribe. Cualquier otro primer segmento se trata como slug de marca
// blanca: /admin/sellea sirve el mismo panel con la URL por marca.
const RESERVED_ADMIN_ROUTES = new Set([
  'academia',
  'accounting',
  'affiliate-registration',
  'ai-knowledge',
  'audit',
  'automatizaciones',
  'branding',
  'business-categories',
  'business-groups',
  'commissions',
  'contabilidad',
  'creditos',
  'industries',
  'infolinks',
  'integrations',
  'lab',
  'maintenance',
  'map',
  'mensajes',
  'pagos-manuales',
  'payouts',
  'pending-payments',
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
  // Cuponera / Cuponera Card (marketplace de beneficios). Nunca es slug de tenant.
  'cuponera',
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

// Última resolución POSITIVA por host (sin expiración). Regla dura: si el
// backend falla, un host que YA resolvió a un tenant/marca sigue sirviéndolo →
// NUNCA se degrada a la landing de Clubify por un bache del backend/DB.
// (Bug 2026-08-14: durante la caída de la DB el fetch daba 500, se cacheaba
// null y los dominios de marca blanca servían la landing de Clubify — y seguían
// haciéndolo aún después de recuperarse, hasta que expiraba el TTL del null.)
const lastKnownStorefront = new Map<string, string>();
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
      // Fallo del backend: NO envenenar la caché con null; usar la última
      // resolución conocida (si la hay) para no caer a Clubify.
      return lastKnownStorefront.get(host) ?? null;
    }
    const j = (await r.json()) as { slug?: string | null };
    const slug = j?.slug ?? null;
    cache.set(host, { slug, until: now + TTL_MS });
    if (slug) lastKnownStorefront.set(host, slug);
    return slug;
  } catch {
    return lastKnownStorefront.get(host) ?? null;
  }
}

// Cache del host → marca blanca (dominio propio del panel, ej. app.marca.com).
const brandCache = new Map<string, { slug: string | null; until: number }>();
// Última marca conocida por host (sin expiración) — misma regla dura que arriba:
// el dominio de una marca blanca NUNCA cae a Clubify por un fallo del backend.
const lastKnownBrand = new Map<string, string>();
async function resolveBrandHost(host: string): Promise<string | null> {
  const now = Date.now();
  const hit = brandCache.get(host);
  if (hit && hit.until > now) return hit.slug;
  try {
    const r = await fetch(
      `${API}/api/superadmin-public/white-labels/resolve-host?host=${encodeURIComponent(host)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) {
      // Fallo del backend: última marca conocida, NO null (que serviría Clubify).
      return lastKnownBrand.get(host) ?? null;
    }
    const j = (await r.json()) as { slug?: string | null };
    const slug = j?.slug ?? null;
    brandCache.set(host, { slug, until: now + TTL_MS });
    if (slug) lastKnownBrand.set(host, slug);
    return slug;
  } catch {
    return lastKnownBrand.get(host) ?? null;
  }
}

// Cache host → favicon de la marca (faviconUrl/iconUrl/logoUrl). Los browsers
// piden /favicon.ico de la raíz y lo priorizan/cachean por encima del <link>;
// como el estático /public/favicon.ico es el de Clubify e igual en todos los
// dominios, en el dominio de una marca redirigimos /favicon.ico a SU favicon.
const faviconCache = new Map<string, { url: string | null; until: number }>();
const lastKnownFavicon = new Map<string, string>();
async function resolveBrandFavicon(host: string): Promise<string | null> {
  const now = Date.now();
  const hit = faviconCache.get(host);
  if (hit && hit.until > now) return hit.url;
  try {
    const r = await fetch(
      `${API}/api/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(host)}`,
      { cache: 'no-store' },
    );
    if (!r.ok) {
      // Fallo del backend: último favicon conocido, NO el de Clubify.
      return lastKnownFavicon.get(host) ?? null;
    }
    const d = (await r.json()) as {
      slug?: string | null;
      faviconUrl?: string | null;
      iconUrl?: string | null;
      logoUrl?: string | null;
      brandingVersion?: number | null;
    } | null;
    // Redirigimos al endpoint generador (48px nítido, fondo transparente) en
    // vez de a la imagen cruda — así el favicon tiene tamaño correcto aunque
    // la marca haya subido un logo grande. ?v=version invalida cache al cambiar.
    const url =
      d && d.slug && d.slug !== 'clubify'
        ? `${API}/api/superadmin-public/white-labels/icon?slug=${encodeURIComponent(d.slug)}&size=48&purpose=any&v=${Number(d.brandingVersion) || 0}`
        : null;
    faviconCache.set(host, { url, until: now + TTL_MS });
    if (url) lastKnownFavicon.set(host, url);
    return url;
  } catch {
    return lastKnownFavicon.get(host) ?? null;
  }
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0];

  // ────────── Favicon de la raíz por marca ──────────
  // En el dominio de una marca, /favicon.ico debe ser el de la marca, no el
  // estático de Clubify. Redirigimos a su favicon (si tiene). Clubify y los
  // hosts reservados caen al estático normal.
  if (url.pathname === '/favicon.ico' && host && !RESERVED_HOSTS.has(host)) {
    const fav = await resolveBrandFavicon(host);
    if (fav) return NextResponse.redirect(fav, 307);
  }

  // ────────── Dominio dedicado del Super Admin: soyfidelity.com ──────────
  // El master admin (rol PLATFORM_OWNER) vive SOLO en soyfidelity.com:
  //  - soyfidelity.com/            → landing de venta de marcas blancas (/fidelity).
  //  - soyfidelity.com/login       → login del master admin (→ /superadmin).
  //  - resto de rutas del dominio  → se sirven normal (/superadmin, assets…).
  //  - En CUALQUIER otro dominio, /superadmin se BLOQUEA y redirige aquí, para
  //    que el panel de plataforma no quede expuesto en soyclubify.com ni en los
  //    dominios de marcas blancas. (localhost queda exento para desarrollo.)
  const isSuperadminHost =
    host === 'soyfidelity.com' || host === 'www.soyfidelity.com';
  const isDevHost = host === 'localhost' || host === '127.0.0.1';

  if (isSuperadminHost) {
    if (url.pathname === '/' || url.pathname === '') {
      const rewrite = url.clone();
      rewrite.pathname = '/fidelity';
      return NextResponse.rewrite(rewrite);
    }
    // "Entrar como empresa" navega a soyfidelity.com/admin/<slug>; sin este
    // rewrite Next servía /admin/<slug> como ruta inexistente → 404. Aquí lo
    // reescribimos al panel /admin (con el slug en header) igual que en los
    // demás hosts, pero ANTES del next() de abajo. Sin re-login (el token de
    // impersonación ya está en soyfidelity.com).
    const saAdmin = url.pathname.match(/^\/admin\/([^/]+)(\/.*)?$/);
    if (saAdmin && !RESERVED_ADMIN_ROUTES.has(saAdmin[1])) {
      const rest = saAdmin[2] ?? '';
      const rewrite = url.clone();
      rewrite.pathname = `/admin${rest}`;
      const reqHeaders = new Headers(req.headers);
      reqHeaders.set('x-wl-slug', saAdmin[1]);
      return NextResponse.rewrite(rewrite, { request: { headers: reqHeaders } });
    }
    return NextResponse.next();
  }

  if (
    !isDevHost &&
    (url.pathname === '/superadmin' || url.pathname.startsWith('/superadmin/'))
  ) {
    const dest = new URL(url.pathname + url.search, 'https://soyfidelity.com');
    return NextResponse.redirect(dest, 307);
  }

  // ────────── Subdominio de la Cuponera / Cuponera Card ──────────
  // cuponera.soyclubify.com sirve el marketplace de beneficios Cuponera Card:
  //  - raíz '/'     → /cuponera (landing + planes)
  //  - /cuponera/*  → pasa directo (early-exit de abajo lo deja seguir)
  //  - assets/api   → normal
  // Los links internos usan rutas absolutas /cuponera/* → funcionan igual en el
  // subdominio y en localhost (path-based) sin lógica dependiente del host.
  const isCuponeraHost =
    host === 'cuponera.soyclubify.com' || host === 'cuponera.clubify.app';
  if (isCuponeraHost) {
    if (url.pathname === '/' || url.pathname === '') {
      const rewrite = url.clone();
      rewrite.pathname = '/cuponera';
      return NextResponse.rewrite(rewrite);
    }
    return NextResponse.next();
  }

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
    // Pasamos el slug de marca como header → el layout server de /admin resuelve
    // el color por slug e inyecta el tema en el SSR aunque el host sea Clubify
    // (marca sin dominio propio conectado todavía). Evita el flash (FODT).
    const reqHeaders = new Headers(req.headers);
    reqHeaders.set('x-wl-slug', adminBrand[1]);
    return NextResponse.rewrite(rewrite, { request: { headers: reqHeaders } });
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
    url.pathname.startsWith('/entrar') ||
    url.pathname.startsWith('/forgot') ||
    url.pathname.startsWith('/reset') ||
    url.pathname.startsWith('/scan') ||
    // Lanzador por rol: es pantalla privada de panel, no la página
    // pública de un negocio. Sin esta línea, en el dominio de una marca
    // blanca /hub se reescribiría al sitio del tenant.
    url.pathname.startsWith('/hub') ||
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
    url.pathname.startsWith('/domicilios') ||
    url.pathname.startsWith('/cuponera') ||
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

  // 1.5 Dominio propio de marca blanca. Convención:
  //   - app.<marca>.com  → PANEL de administración (/admin)
  //   - <marca>.com / www → LANDING de marketing (/<slug>, ej. /sellea)
  // Las rutas del sistema (/admin, /login, /_next, assets) ya salieron por el
  // early-exit de arriba y se sirven normal en cualquiera de estos dominios;
  // acá solo la raíz '/' se reescribe al destino que corresponde al host.
  const brandSlug = await resolveBrandHost(host);
  if (brandSlug) {
    if (url.pathname === '/' || url.pathname === '') {
      const rewrite = url.clone();
      // app.<marca> → panel; dominio de marketing (raíz/www) → landing /<slug>.
      rewrite.pathname = host.startsWith('app.') ? '/admin' : `/${brandSlug}`;
      return NextResponse.rewrite(rewrite);
    }
    return NextResponse.next();
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
