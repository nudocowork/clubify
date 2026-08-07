'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, clearSession, getUser, getImpersonationBackup, stopImpersonation } from '@/lib/api';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';
import { TrialBanner } from './TrialBanner';
import { CommandPalette, CommandHint } from './CommandPalette';
import { QuickCreateFAB } from './QuickCreateFAB';
import { CardVerificationLockscreen } from './CardVerificationLockscreen';
import { TrialExpiredLockscreen } from './TrialExpiredLockscreen';
import { Logo } from './Logo';
import { TenantSwitcher } from './TenantSwitcher';
import { SupportWidget } from './SupportWidget';
import { LoginPopupBroadcast } from './LoginPopupBroadcast';
import { useBranding } from '@/lib/useBranding';
import { panelBrandCss } from '@/lib/panel-brand-theme';
import {
  getCategoryBySlug,
  resolveMainSectionLabel,
  type BusinessModule,
} from '@/lib/business-categories';

// useLayoutEffect avisa en SSR (no corre en server). Alias isomórfico: en
// cliente corre SÍNCRONO antes del primer paint (para sembrar el branding sin
// flash); en server cae a useEffect (no-op visual, sin warning).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type IconName = Parameters<typeof Icon>[0]['name'];

// mixHex + panelBrandCss viven en @/lib/panel-brand-theme (compartidos con los
// layouts server del panel para evitar el flash del tema por defecto / FODT).

// Subrutas reales de /admin (carpetas en app/admin). Si el primer segmento
// tras /admin NO es una de estas, se trata como slug de marca blanca
// (/admin/<slug>). Debe coincidir con RESERVED_ADMIN_ROUTES del middleware.
const ADMIN_ROUTE_SEGMENTS = new Set([
  'accounting', 'affiliate-registration', 'ai-knowledge', 'audit', 'branding',
  'business-categories', 'business-groups', 'commissions', 'creditos', 'industries', 'integrations',
  'lab', 'maintenance', 'map', 'payouts', 'rankings', 'referrals', 'reports',
  'sales-leaderboard', 'sales-teams', 'support-materials', 'tenants', 'trials',
  'users', 'ventas',
]);

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Si está seteado, el item solo se muestra si la categoría del negocio
   *  habilita ese módulo. Sin module = visible siempre. */
  module?: BusinessModule;
  /** Si está true, el item NO se muestra para usuarios con rol MARKETING.
   *  Aplica solo al sidebar admin (financiero, admins, infra). */
  hideForMarketing?: boolean;
  /** Link externo (abre en nueva pestaña). Usado para Tutoriales /
   *  Academia Clubify (Bloque 2 2026-06-12). */
  external?: boolean;
  /** Contador opcional (ej negocios pendientes en Créditos). */
  badge?: string;
  /** Solo visible para Clubify / plataforma (config global tipo Branding).
   *  Se oculta cuando la marca activa es una marca blanca distinta. */
  clubifyOnly?: boolean;
  /** Si está seteado, el item (sidebar admin) solo se muestra si la MARCA activa
   *  tiene ese módulo habilitado (ej. 'GROW_BUSINESS_SMS' para Automatizaciones).
   *  Con brandModules sin resolver (Clubify/global) se muestra. */
  requiresBrandModule?: string;
};
type NavGroup = { section: string; items: NavItem[]; badge?: string };

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

function avatarColor(seed: string) {
  const sum = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `avatar-${(sum % 7) + 1}`;
}

// Las raíces "/app" y "/admin" deben matchear solo exact path, sino
// "Dashboard" quedaría activo en cualquier subruta (/app/menu, /app/orders, etc).
function isHrefActive(href: string, pathname: string) {
  if (href === '/app' || href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

/** Devuelve el href "más específico" que matchea el pathname actual.
 *  Esto evita que parent routes (ej. /app/reservations) queden activos
 *  cuando el usuario está en una sub-ruta (ej. /app/reservations/eventos)
 *  donde otro item también matchea de forma exacta. */
function findBestActiveHref(allHrefs: string[], pathname: string): string | null {
  let best: string | null = null;
  for (const h of allHrefs) {
    if (!isHrefActive(h, pathname)) continue;
    if (best === null || h.length > best.length) best = h;
  }
  return best;
}

export default function AppShell({
  variant,
  children,
  serverBrandColor = null,
  serverBrandBackground = null,
  serverBrandLogo = null,
  serverBrandName = null,
}: {
  variant: 'admin' | 'app';
  children: React.ReactNode;
  /** Color de la marca resuelto en el SERVIDOR por host (layout del panel).
   *  Se usa como valor inicial del tema → el primer paint (SSR) ya sale con el
   *  color real, sin flash del verde Clubify (FODT). */
  serverBrandColor?: string | null;
  /** Color propio del fondo del sidebar (backgroundColor de la marca), resuelto
   *  en el SERVIDOR → primer paint del sidebar con su tono, sin flash. */
  serverBrandBackground?: string | null;
  /** Logo de la marca resuelto en el SERVIDOR (host/slug). Se usa en el primer
   *  paint del sidebar/topbar mientras el cliente confirma la marca → evita el
   *  flash del logo Clubify (FODT del logo). null = Clubify (sin marca). */
  serverBrandLogo?: string | null;
  /** Nombre de la marca resuelto en el SERVIDOR → título del panel sin flash. */
  serverBrandName?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const branding = useBranding();
  // PDF 1254: último locale de negocio aplicado (para no re-sincronizar el
  // mismo, pero SÍ cuando se cambia de negocio dentro del mismo mount).
  const lastSyncedLocaleRef = useRef<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [impersonation, setImpersonation] = useState<ReturnType<typeof getImpersonationBackup>>(null);
  // Seed anti-flash (FODT) del panel /app. Al entrar por "Entrar al negocio"
  // (impersonation) el backup en sessionStorage YA trae el branding de la marca
  // blanca del negocio (color/logo/nombre). Lo leemos ANTES del primer paint
  // (useLayoutEffect) → el panel sale con la identidad real desde el frame 1,
  // sin esperar el fetch async de /tenants/me (que causaba el flash del verde
  // Clubify + logo genérico + "Mi Negocio").
  const [appSeed, setAppSeed] = useState<{
    brandName: string | null;
    whiteLabelSlug: string | null;
    name: string | null;
    color: string | null;
    icon: string | null;
    logo: string | null;
  } | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  // Branding de la marca activa resuelto por slug (para login directo a
  // /admin/<slug> donde no hay pila de impersonación con el branding).
  const [brandFetched, setBrandFetched] = useState<{
    name: string;
    color: string | null;
    // Color propio del fondo del sidebar del panel (opcional). Si la marca lo
    // definió, el sidebar usa ESTE tono en vez del derivado del acento.
    backgroundColor: string | null;
    logoUrl: string | null;
    iconUrl: string | null;
    slug: string;
    modules: string[];
  } | null>(null);
  // Fase 3 (#6): si el admin actual es de una marca blanca con créditos
  // (no ilimitada), se muestra la sección "Créditos" en /admin. Para
  // Clubify / PLATFORM_OWNER el endpoint da 403 y queda oculta.
  const [showCredits, setShowCredits] = useState(false);
  const [pendingCreditsCount, setPendingCreditsCount] = useState(0);
  const [tenantInfo, setTenantInfo] = useState<{
    brandName?: string;
    hotmartSubscriberCode?: string | null;
    businessCategorySlug?: string | null;
    mainSectionLabelOverride?: string | null;
    isLocked?: boolean;
    // Trial nuevo (/prueba o /trial): si trialEndsAt está set, este tenant
    // no pasó por Hotmart antes del primer login — el lockscreen normal
    // de "completar pago" NO aplica hasta que el trial expire.
    trialEndsAt?: string | null;
    status?: string | null;
    // Bloque 2 (2026-06-12): toggles per-tenant para ocultar los links
    // externos de Tutoriales / Academia Clubify desde admin.
    tutorialsEnabled?: boolean;
    academyEnabled?: boolean;
    // Reservations module 2026-06-12. SUPER_ADMIN lo activa per-tenant.
    reservationsEnabled?: boolean;
    // Reservas de SERVICIOS (citas) — PDF245 P7. Activado per-tenant.
    serviceReservationsEnabled?: boolean;
    // Tipo de negocio: 'INFOLINK' = panel reducido (solo InfoLink). null/'FULL'
    // = Negocio Completo (todos los módulos).
    businessType?: string | null;
    // Master Admin 2026-06-14: si la marca blanca tiene créditos ilimitados,
    // este tenant nunca necesita pasar por Hotmart. Salta el lockscreen.
    whiteLabelCreditsUnlimited?: boolean;
    // Módulo Reseñas de la marca (default true). Si la marca lo apaga, se
    // ocultan los items de reseñas del menú.
    reviewsEnabled?: boolean;
    // Slug de la marca blanca del negocio (null = legacy → 'clubify').
    whiteLabelSlug?: string | null;
    // Nombre de la marca blanca (identidad del asistente IA del panel).
    whiteLabelName?: string | null;
    // Módulo COMMUNITY de la marca: gatea la sección Comunidad/Lab en el panel
    // del negocio (genérico por marca). Default true mientras carga (sin flicker).
    communityEnabled?: boolean;
    // Módulo REFERRALS de la marca: gatea el item "Referidos" del panel del
    // negocio. Si la marca lo tiene apagado (ej. Sellea) no aparece. Default
    // true mientras carga (sin flicker).
    referralsEnabled?: boolean;
    // Wallet V3 — permisos "Wallet Avanzado" de la marca (gatea Historial de
    // sellos, etc). null/clave ausente = activo (heredado).
    walletAdvanced?: Record<string, boolean> | null;
    // Branding de la marca blanca para pintar el panel /app (logo + colores).
    // null = Clubify → defaults. Evita el verde + logo Clubify en otra marca.
    whiteLabelBranding?: {
      logoUrl: string | null;
      iconUrl: string | null;
      faviconUrl: string | null;
      primaryColor: string | null;
      secondaryColor: string | null;
      backgroundColor: string | null;
      supportColor: string | null;
    } | null;
  } | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  // Si el usuario ya tocó algún toggle, respetamos su preferencia. Si no,
  // por default todas las secciones quedan colapsadas (la activa se
  // auto-expande igual gracias al hasActive en el render).
  const [hasUserPref, setHasUserPref] = useState(false);

  // Cargar/persistir preferencia de secciones colapsadas
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('clubify:nav:collapsed');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setCollapsedSections(new Set(arr));
          setHasUserPref(true);
        }
      }
    } catch {}
  }, []);

  // Lista de los nombres de sección visibles actualmente — la usa
  // toggleSection cuando es la primera vez que el user toca un toggle
  // (estado default: todas colapsadas) para invertir la semántica del
  // set sin tener que recalcular `groups` desde el closure.
  const sectionNamesRef = useRef<string[]>([]);
  // Href más específico que matchea el pathname actual — calculado en el
  // render del nav y leído por cada item para decidir su estado activo.
  const bestActiveHrefRef = useRef<string | null>(null);

  function toggleSection(name: string) {
    if (!hasUserPref) {
      // Primer toggle — el user quiere expandir esta sección. Como todas
      // estaban colapsadas por default, llenamos el set con TODAS las
      // secciones EXCEPTO la clickeada (que queda expandida).
      const next = new Set(
        sectionNamesRef.current.filter((n) => n && n !== name),
      );
      setCollapsedSections(next);
      setHasUserPref(true);
      try {
        localStorage.setItem(
          'clubify:nav:collapsed',
          JSON.stringify(Array.from(next)),
        );
      } catch {}
      return;
    }
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        localStorage.setItem(
          'clubify:nav:collapsed',
          JSON.stringify(Array.from(next)),
        );
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    setImpersonation(getImpersonationBackup());
  }, [pathname]);

  // Pre-paint: siembra el branding del negocio impersonado en el panel /app
  // (ver appSeed). Corre síncrono antes del primer frame → sin flash del tema
  // verde por defecto ni de "Mi Negocio".
  useIsomorphicLayoutEffect(() => {
    if (variant !== 'app') return;
    const t = getImpersonationBackup()?.tenant;
    if (!t) return;
    setAppSeed({
      brandName: t.brandName ?? null,
      whiteLabelSlug: t.whiteLabelSlug ?? null,
      name: t.whiteLabelName ?? null,
      color: t.primaryColor ?? null,
      icon: t.iconUrl ?? null,
      logo: t.logoUrl ?? null,
    });
  }, [variant, pathname]);

  // Resuelve branding + módulos de la marca activa por slug (de la pila de
  // impersonación o de la URL /admin/<slug>). Se fetchea SIEMPRE que haya una
  // marca activa (no solo en login directo) porque el gating de menú por
  // módulos (#2) necesita la lista de módulos también al impersonar.
  useEffect(() => {
    if (variant !== 'admin') {
      setBrandFetched(null);
      return;
    }
    const backup = getImpersonationBackup();
    const m = pathname.match(/^\/admin\/([^/]+)/);
    const urlSlug = m && !ADMIN_ROUTE_SEGMENTS.has(m[1]) ? m[1] : null;
    const slug = backup?.tenant?.slug || urlSlug;
    let cancelled = false;
    type BrandResp = {
      name: string;
      primaryColor: string;
      backgroundColor?: string | null;
      logoUrl?: string | null;
      iconUrl?: string | null;
      slug: string;
      modules?: string[];
    } | null;
    const apply = (r: BrandResp) => {
      if (cancelled || !r) return;
      // Clubify NO se trata como "marca activa": deja el branding default y el
      // panel global sin prefijo de slug.
      if (r.slug === 'clubify') {
        setBrandFetched(null);
        return;
      }
      setBrandFetched({
        name: r.name,
        color: r.primaryColor,
        backgroundColor: r.backgroundColor ?? null,
        logoUrl: r.logoUrl ?? null,
        iconUrl: r.iconUrl ?? null,
        slug: r.slug,
        modules: r.modules ?? [],
      });
    };
    const req: Promise<BrandResp> = slug
      ? api<BrandResp>(
          `/superadmin-public/white-labels/branding?slug=${encodeURIComponent(slug)}`,
        )
      : // Login DIRECTO de un admin de marca por su dominio (ej.
        // app.selleala.com): no hay slug en la URL ni pila de impersonación →
        // resolvemos la marca por el host para pintar el panel con su identidad.
        api<BrandResp>(
          `/superadmin-public/white-labels/branding-by-host?host=${encodeURIComponent(
            typeof window !== 'undefined' ? window.location.host : '',
          )}`,
        );
    req.then(apply).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [variant, pathname]);

  // Fase 3 (#6/#7): resuelve si el admin tiene panel de créditos por marca.
  // 403 (admin global Clubify) o marca ilimitada → oculto.
  useEffect(() => {
    if (variant !== 'admin') {
      setShowCredits(false);
      return;
    }
    let cancelled = false;
    api<{ unlimited?: boolean; pendingTenants?: number } | null>('/admin/credits')
      .then((r) => {
        if (cancelled) return;
        if (r && !r.unlimited) {
          setShowCredits(true);
          setPendingCreditsCount(r.pendingTenants ?? 0);
        } else {
          setShowCredits(false);
        }
      })
      .catch(() => {
        if (!cancelled) setShowCredits(false);
      });
    return () => {
      cancelled = true;
    };
    // whiteLabelId viene del JWT (estable por sesión) → 1 fetch, no por nav.
  }, [variant]);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    // Detección de estado inconsistente: localStorage.clubify_user dice
    // que estás logueado pero la cookie clubify_token desapareció (cookie
    // expiró antes de localStorage, o user borró cookies). Antes la app
    // te dejaba entrar y TODAS las requests fallaban 401 sin pista clara.
    // Ahora forzamos un re-login limpio.
    const hasTokenCookie =
      typeof document !== 'undefined' &&
      /(^|;\s*)clubify_token=/.test(document.cookie);
    if (!hasTokenCookie) {
      clearSession();
      router.push('/login?expired=1');
      return;
    }
    const isAdminRole = u.role === 'SUPER_ADMIN' || u.role === 'MARKETING';
    if (variant === 'admin' && !isAdminRole) router.push('/app');
    if (variant === 'app' && isAdminRole) router.push('/admin');
    setUser(u);
  }, [router, variant]);

  // Route guard MARKETING: bloquea rutas admin no permitidas (financiero,
  // gestión de admins, infra). Lista mantenida en paralelo con el sidebar:
  // si agregas un item con hideForMarketing aquí también va el prefijo.
  useEffect(() => {
    if (!user || variant !== 'admin') return;
    if (user.role !== 'MARKETING') return;
    const blocked = [
      '/admin/users',
      '/admin/referrals',
      '/admin/reports',
      '/admin/rankings',
      '/admin/commissions',
      '/admin/maintenance',
      '/admin/audit',
      '/admin/tenants/new',
      '/admin/map',
      // ALTO #8 (2026-06-12): payouts (gestión de pagos a afiliados) es
      // dato financiero sensible. Estaba oculto en el sidebar pero el
      // route guard no lo bloqueaba — MARKETING podía entrar por URL
      // directa. Ahora también está bloqueado.
      '/admin/payouts',
    ];
    if (blocked.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
      router.replace('/admin');
    }
  }, [pathname, user, variant, router]);

  // Route guard "Solo pedidos" (TENANT_ORDERS): este empleado solo puede estar
  // en /app/orders*. Cualquier otra ruta de /app (o el root) lo redirige a
  // Pedidos. El backend además bloquea por rol (default-deny) — esto es la capa
  // de UX para que no navegue por URL directa.
  useEffect(() => {
    if (!user || variant !== 'app') return;
    if (user.role !== 'TENANT_ORDERS') return;
    if (!pathname.startsWith('/app/orders')) {
      router.replace('/app/orders');
    }
  }, [pathname, user, variant, router]);

  // #5 Route guard: las páginas de config de PLATAFORMA (Branding,
  // Integraciones SMS) son solo de Clubify. Una marca blanca distinta no debe
  // poder entrar ni por URL directa → redirige a /admin. El slug de marca se
  // resuelve de la pila de impersonación o de la URL /admin/<slug>.
  useEffect(() => {
    if (!user || variant !== 'admin') return;
    const m = pathname.match(/^\/admin\/([^/]+)/);
    const urlSlug = m && !ADMIN_ROUTE_SEGMENTS.has(m[1]) ? m[1] : null;
    const slug = getImpersonationBackup()?.tenant?.slug || urlSlug;
    const isOtherBrand = !!slug && slug !== 'clubify';
    if (!isOtherBrand) return;
    const clubifyOnlyRoutes = [
      '/admin/branding',
      '/admin/integrations',
      '/admin/business-groups',
    ];
    const here = urlSlug
      ? pathname.replace(`/admin/${urlSlug}`, '/admin')
      : pathname;
    if (clubifyOnlyRoutes.some((p) => here === p || here.startsWith(p + '/'))) {
      router.replace(urlSlug ? `/admin/${urlSlug}` : '/admin');
    }
  }, [pathname, user, variant, router]);

  // Cargar plan del tenant para mostrar badges Pro en sidebar y detectar
  // si todavía falta verificar la tarjeta en Hotmart (lockscreen).
  useEffect(() => {
    if (variant !== 'app') return;
    api<any>('/tenants/me')
      .then((t) => {
        setPlanName(t?.plan?.name ?? null);
        setTenantInfo({
          brandName: t?.brandName,
          hotmartSubscriberCode: t?.hotmartSubscriberCode ?? null,
          businessCategorySlug: t?.businessCategorySlug ?? null,
          mainSectionLabelOverride: t?.mainSectionLabelOverride ?? null,
          isLocked: t?.isLocked ?? false,
          trialEndsAt: t?.trialEndsAt ?? null,
          status: t?.status ?? null,
          tutorialsEnabled: t?.tutorialsEnabled ?? true,
          academyEnabled: t?.academyEnabled ?? true,
          reservationsEnabled: t?.reservationsEnabled ?? false,
          serviceReservationsEnabled: t?.serviceReservationsEnabled ?? false,
          businessType: t?.businessType ?? 'FULL',
          whiteLabelCreditsUnlimited: t?.whiteLabelCreditsUnlimited ?? false,
          reviewsEnabled: t?.reviewsEnabled ?? true,
          whiteLabelSlug: t?.whiteLabelSlug ?? null,
          whiteLabelName: t?.whiteLabelName ?? null,
          communityEnabled: t?.communityEnabled ?? true,
          referralsEnabled: t?.referralsEnabled ?? true,
          walletAdvanced: t?.walletAdvanced ?? null,
          whiteLabelBranding: t?.whiteLabelBranding ?? null,
        });
        // PDF 1254 — idioma POR NEGOCIO: si el idioma activo del panel (cookie
        // NEXT_LOCALE) difiere del idioma del NEGOCIO, lo aplicamos y
        // refrescamos UNA sola vez. Así, al entrar a un negocio, el panel se ve
        // en su idioma, independiente de otros negocios. El guard evita loops.
        const tenantLocale: string | undefined = t?.locale;
        const activeLocale =
          document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1] ?? '';
        if (
          tenantLocale &&
          tenantLocale !== activeLocale &&
          lastSyncedLocaleRef.current !== tenantLocale
        ) {
          lastSyncedLocaleRef.current = tenantLocale;
          fetch('/api/locale', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale: tenantLocale }),
          })
            .then(() => router.refresh())
            .catch(() => {});
        }
      })
      .catch(() => null);
  }, [variant, pathname]);

  // Cerrar drawer al navegar
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Bloquear scroll body cuando el drawer está abierto
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = navOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [navOpen]);

  // Favicon del panel del negocio por TENANT (no solo por host): si la marca
  // del tenant ≠ clubify y tiene favicon propio, lo aplicamos. Cubre el caso
  // de acceder al panel de un negocio de otra marca desde el dominio Clubify
  // (donde DynamicFavicon, host-based, mostraría el de Clubify). Escribimos
  // sobre el MISMO <link> id que DynamicFavicon → un solo icono, sin pelea.
  useEffect(() => {
    if (variant !== 'app' || typeof document === 'undefined') return;
    const wl = tenantInfo?.whiteLabelBranding;
    const slug = tenantInfo?.whiteLabelSlug;
    if (!wl || !slug || slug === 'clubify') return;
    const fav = wl.faviconUrl || wl.iconUrl || wl.logoUrl;
    if (!fav) return;
    const ID = '__clubify_dynamic_favicon';
    let link = document.getElementById(ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.id = ID;
      link.rel = 'icon';
      link.type = 'image/png';
      document.head.appendChild(link);
    }
    if (link.href !== fav) link.href = fav;
  }, [variant, tenantInfo?.whiteLabelSlug, tenantInfo?.whiteLabelBranding]);

  const isMarketing = user?.role === 'MARKETING';

  // Slug + módulos de la marca activa. DEBEN declararse ANTES de `groups`:
  // el IIFE de `groups` (más abajo) lee `brandModules` para gatear secciones,
  // y `const` no se hoistea → si se declaran después da TDZ ("Cannot access
  // before initialization") y la pantalla crashea con "Algo salió mal".
  const urlBrandMatch = pathname.match(/^\/admin\/([^/]+)/);
  const urlBrandSlug =
    urlBrandMatch && !ADMIN_ROUTE_SEGMENTS.has(urlBrandMatch[1])
      ? urlBrandMatch[1]
      : null;
  const brandSlug =
    variant === 'admin'
      ? impersonation?.tenant?.slug || urlBrandSlug || brandFetched?.slug || null
      : null;
  // null = aún sin resolver o sin marca (global) → no se gatea nada.
  const brandModules =
    variant === 'admin' && brandSlug ? brandFetched?.modules ?? null : null;

  const groups: NavGroup[] =
    variant === 'admin'
      ? (() => {
          const adminGroups: NavGroup[] = [
            {
              section: 'Principal',
              items: [
                { href: '/admin', label: 'Dashboard', icon: 'grid' },
                { href: '/admin/tenants', label: 'Negocios', icon: 'store' },
                { href: '/admin/business-groups', label: 'Grupos Empresariales', icon: 'store', hideForMarketing: true, clubifyOnly: true },
                { href: '/admin/map', label: 'Mapa', icon: 'pin', hideForMarketing: true },
                // Trials es exclusivo de Clubify: las marcas blancas no tienen
                // periodo de prueba (se activan por créditos), así que se oculta
                // para cualquier marca ≠ clubify (mismo gating que Branding).
                { href: '/admin/trials', label: 'Trials', icon: 'gift', clubifyOnly: true },
              ],
            },
            {
              section: 'Programa',
              items: [
                { href: '/admin/referrals', label: 'Referidos', icon: 'gift', hideForMarketing: true },
                { href: '/admin/commissions', label: 'Comisiones', icon: 'trend-up', hideForMarketing: true },
                { href: '/admin/commissions/audit', label: 'Auditoría duplicados', icon: 'trend-up', hideForMarketing: true },
                { href: '/admin/payouts', label: 'Pagos a afiliados', icon: 'card', hideForMarketing: true },
                { href: '/admin/reports/ambassadors', label: 'Reporte embajadores', icon: 'trend-up', hideForMarketing: true },
                { href: '/admin/reports/vendors', label: 'Reporte vendedores', icon: 'trend-up', hideForMarketing: true },
                { href: '/admin/rankings', label: 'Rankings', icon: 'spark', hideForMarketing: true },
                { href: '/admin/support-materials', label: 'Material de apoyo', icon: 'spark' },
              ],
            },
            {
              section: 'Ventas',
              items: [
                { href: '/admin/industries', label: 'Industrias', icon: 'grid' },
                { href: '/admin/sales-teams', label: 'Equipos de ventas', icon: 'users', hideForMarketing: true },
                { href: '/admin/sales-leaderboard', label: 'Leaderboard CRM', icon: 'trend-up', hideForMarketing: true },
                { href: '/admin/ventas/difusion', label: 'Difusión interna', icon: 'spark', hideForMarketing: true },
              ],
            },
            {
              section: 'Sistema',
              items: [
                // Fase 3 (#6/#7): sección Créditos solo para admins de marca
                // blanca no-ilimitada (showCredits). Badge = negocios
                // pendientes de activación.
                ...(showCredits
                  ? [
                      {
                        href: '/admin/creditos',
                        label: 'Créditos',
                        icon: 'card' as const,
                        badge:
                          pendingCreditsCount > 0
                            ? String(pendingCreditsCount)
                            : undefined,
                        hideForMarketing: true,
                      },
                    ]
                  : []),
                { href: '/admin/users', label: 'Administradores', icon: 'users', hideForMarketing: true },
                // Academia — videos-tutorial por módulo (por marca).
                { href: '/admin/academia', label: '🎓 Academia', icon: 'spark', hideForMarketing: true },
                // Automatizaciones (mensajes SMS/WhatsApp editables + carpetas).
                // Solo si la marca tiene el módulo GROW_BUSINESS_SMS habilitado.
                { href: '/admin/automatizaciones', label: 'Automatizaciones', icon: 'bell', hideForMarketing: true, requiresBrandModule: 'GROW_BUSINESS_SMS' },
                // #5: Branding e Integraciones SMS son config de PLATAFORMA
                // (landing de Clubify, tabla Setting global). Una marca blanca
                // gestiona su identidad desde Master Admin → Marcas, no acá, así
                // que se ocultan para marcas que no sean Clubify.
                { href: '/admin/branding', label: 'Branding', icon: 'spark', clubifyOnly: true },
                { href: '/admin/integrations', label: 'Integraciones SMS', icon: 'spark', clubifyOnly: true },
                // #4: Categorías + IA Knowledge ocultos (no relevantes para
                // el usuario final). #5: Mantenimiento + Audit movidos a
                // Master Admin (/superadmin) exclusivamente.
              ],
            },
            {
              section: 'Comunidad',
              items: [
                // Item 13 sprint: review queue + métricas de las propuestas.
                // Accesible a MARKETING (no requiere hideForMarketing).
                // Comunidad/Lab se gatea por el módulo COMMUNITY de la marca
                // (Fase 4): visible solo si la marca lo tiene habilitado.
                { href: '/admin/lab', label: '🧪 Lab Admin', icon: 'spark' },
                { href: '/lab', label: 'Ver Lab público', icon: 'spark' },
              ],
            },
          ];
          // #2/#4: gating de secciones por módulo de la marca. brandModules null
          // = marca sin resolver / global (host propio) → mostrar todo (sin
          // flicker). "Programa"/"Ventas" requieren REFERRALS; "Comunidad" (Lab)
          // requiere el módulo COMMUNITY (genérico: cada marca lo habilita por
          // config — solo Clubify lo tiene por defecto).
          const referralSections = new Set(['Programa', 'Ventas']);
          const moduleAllowed = (g: NavGroup) => {
            if (!brandModules) return true;
            if (g.section === 'Comunidad')
              return brandModules.includes('COMMUNITY');
            if (referralSections.has(g.section))
              return brandModules.includes('REFERRALS');
            return true;
          };
          // #5: marca blanca distinta de Clubify → ocultar items clubifyOnly
          // (config de plataforma: Branding, Integraciones SMS).
          const isOtherBrand = !!brandSlug && brandSlug !== 'clubify';
          const visibleItem = (it: NavItem) =>
            (!isOtherBrand || !it.clubifyOnly) &&
            (!isMarketing || !it.hideForMarketing) &&
            // Gate por módulo de la marca (ej. Automatizaciones ↔ GROW_BUSINESS_SMS).
            // brandModules null (Clubify/global sin resolver) → se muestra.
            (!it.requiresBrandModule ||
              !brandModules ||
              brandModules.includes(it.requiresBrandModule));
          return adminGroups
            .filter(moduleAllowed)
            .map((g) => ({ ...g, items: g.items.filter(visibleItem) }))
            .filter((g) => g.items.length > 0);
        })()
      : (() => {
          // Empleado "Solo pedidos" (TENANT_ORDERS): el menú muestra ÚNICAMENTE
          // Pedidos. El resto queda oculto acá y bloqueado por el route guard +
          // los @Roles del backend (default-deny).
          if (user?.role === 'TENANT_ORDERS') {
            return [
              {
                section: '',
                items: [
                  { href: '/app/orders', label: 'Pedidos', icon: 'shopping-bag' as IconName },
                ],
              },
            ] as NavGroup[];
          }
          // Negocio "Solo InfoLink": panel reducido, producto independiente.
          // Solo Dashboard, InfoLink, QR InfoLink, Estadísticas, Suscripción y
          // Configuración. El backend además bloquea el resto de módulos (guard).
          if (tenantInfo?.businessType === 'INFOLINK') {
            return [
              {
                section: '',
                items: [{ href: '/app', label: 'Dashboard', icon: 'grid' as IconName }],
              },
              {
                section: 'InfoLink',
                items: [
                  { href: '/app/info-links', label: 'InfoLink', icon: 'spark' as IconName },
                  { href: '/app/marketing/qr-infolink', label: 'QR InfoLink', icon: 'qr' as IconName },
                  { href: '/app/estadisticas', label: 'Estadísticas', icon: 'history' as IconName },
                ],
              },
              {
                section: 'Cuenta',
                items: [
                  { href: '/app/billing', label: 'Suscripción', icon: 'card' as IconName },
                  { href: '/app/settings', label: 'Configuraciones', icon: 'gear' as IconName },
                ],
              },
            ] as NavGroup[];
          }
          const catSlug = tenantInfo?.businessCategorySlug;
          const cat = getCategoryBySlug(catSlug);
          const has = (m: BusinessModule) => cat.modules.includes(m);
          // Label de sección principal — override custom del tenant pisa el
          // mapping de la categoría. Aplica a sidebar + título de sección +
          // QR Menú (que pasa a "QR Servicios" / "QR Tratamientos" / etc).
          const menuLabel = resolveMainSectionLabel(
            tenantInfo?.mainSectionLabelOverride,
            catSlug,
          );
          // "Menú digital" se queda solo si el label es "Menú"; sino usa el
          // label directo (ya no hay un "digital" que sumar para custom).
          const catalogSectionName =
            menuLabel === 'Menú' ? 'Menú digital' : menuLabel;

          const all: NavGroup[] = [
            // Dashboard standalone (sin header)
            {
              section: '',
              items: [{ href: '/app', label: 'Dashboard', icon: 'grid' }],
            },
            {
              section: 'Tarjetas de fidelización',
              items: [
                { href: '/app/cards', label: 'Tarjetas', icon: 'card', module: 'cards' },
                { href: '/app/customers', label: 'Clientes', icon: 'users', module: 'customers' },
                { href: '/scan', label: 'Escáner', icon: 'qr', module: 'scanner' },
                // Wallet V3 — Historial de sellos, si la marca lo permite.
                ...(tenantInfo?.walletAdvanced?.showHistory !== false
                  ? [{ href: '/app/historial-sellos', label: 'Historial de sellos', icon: 'clock' as const }]
                  : []),
                { href: '/app/notifications', label: 'Push', icon: 'bell', module: 'push' },
                { href: '/app/reviews', label: 'Reseña de Google', icon: 'spark' },
              ],
            },
            // Reservas: solo aparece si el SUPER_ADMIN activó el módulo
            // para el tenant via Tenant.reservationsEnabled.
            ...(tenantInfo?.reservationsEnabled
              ? [
                  {
                    section: 'Reservas',
                    badge: 'NUEVO',
                    items: [
                      { href: '/app/reservations', label: 'Agenda del día', icon: 'calendar' as const },
                      { href: '/app/reservations/plano', label: 'Plano de mesas', icon: 'menu' as const },
                      { href: '/app/reservations/eventos', label: 'Eventos', icon: 'spark' as const },
                      { href: '/app/reservations/online', label: 'Reserva online', icon: 'qr' as const },
                      { href: '/app/reservations/reportes', label: 'Reportes', icon: 'spark' as const },
                    ],
                  },
                ]
              : []),
            // Reservas de SERVICIOS (citas) — PDF245 P7. Gateado por
            // Tenant.serviceReservationsEnabled.
            ...(tenantInfo?.serviceReservationsEnabled
              ? [
                  {
                    section: 'Reservas de servicios',
                    badge: 'NUEVO',
                    items: [
                      { href: '/app/servicios', label: 'Servicios y agenda', icon: 'calendar' as const },
                    ],
                  },
                ]
              : []),
            {
              section: 'Marketing',
              items: [
                // QR de la sección principal — siempre visible. La categoría
                // del negocio solo cambia el label ("Menú" / "Servicios" /
                // "Tratamientos"), no la visibilidad del item.
                { href: '/app/marketing/qr-menu', label: `QR ${menuLabel}` , icon: 'menu' },
                { href: '/app/marketing/qr-counter', label: 'QR Mostrador', icon: 'card' },
                { href: '/app/marketing/qr-discount', label: 'QR Descuento', icon: 'gift' },
                { href: '/app/marketing/qr-reviews', label: 'QR Reseñas', icon: 'spark' },
                { href: '/app/marketing/qr-infolink', label: 'QR Infolink', icon: 'spark' },
              ],
            },
            {
              section: catalogSectionName,
              items: [
                // Sección principal del catálogo — SIEMPRE visible. El label
                // y el QR adaptan al rubro pero el módulo no se oculta por
                // categoría (cualquier negocio puede usar el menú digital).
                { href: '/app/menu', label: menuLabel, icon: 'menu' },
                { href: '/app/menu-book', label: 'Menú Libro', icon: 'book' },
                { href: '/app/translations', label: 'Traducciones', icon: 'spark' },
                { href: '/app/orders', label: 'Pedidos', icon: 'shopping-bag', module: 'orders' },
                { href: '/app/analytics', label: 'Analítica', icon: 'history', module: 'analytics' },
              ],
            },
            {
              section: 'Cuenta',
              items: [
                { href: '/app/staff', label: 'Equipo de trabajo', icon: 'users', module: 'staff' },
                { href: '/app/billing', label: 'Suscripción', icon: 'card' },
                { href: '/app/settings', label: 'Configuraciones', icon: 'gear' },
                // "Referidos" se gatea por el módulo REFERRALS de la MARCA del
                // negocio. Si la marca lo tiene apagado (ej. Sellea) no aparece.
                ...(tenantInfo?.referralsEnabled !== false
                  ? [{ href: '/app/referrals', label: 'Referidos', icon: 'gift' as const }]
                  : []),
              ],
            },
            // Comunidad (Lab + Tutoriales) se gatea por el módulo COMMUNITY de
            // la marca del negocio (Fase 4, genérico). Default true mientras
            // carga. Oculto para marcas sin COMMUNITY (ej. Sellea).
            ...(tenantInfo?.communityEnabled !== false
              ? [
                  {
                    section: 'Comunidad',
                    items: [
                      // Clubify Lab — propuestas y votación pública. Accesible a
                      // todos los roles autenticados (item 13 sprint).
                      { href: '/lab', label: '🧪 Clubify Lab', icon: 'spark' as IconName },
                      // Tutoriales — link externo a la academia (Bloque 2 2026-06-12).
                      // SUPER_ADMIN puede ocultarlo per-tenant desde
                      // /admin/tenants/[id] vía Tenant.tutorialsEnabled.
                      ...(tenantInfo?.tutorialsEnabled !== false
                        ? [
                            {
                              href: 'https://academy.soyclubify.lat/cliente',
                              label: '🎓 Tutoriales',
                              icon: 'book' as IconName,
                              external: true,
                            },
                          ]
                        : []),
                    ],
                  },
                ]
              : []),
          ];

          // Mientras tenantInfo no llegó (primer paint), mostramos todos los
          // items para no flickear. Una vez carga, se filtran.
          if (!tenantInfo) return all;

          // #3 módulo Reseñas: si la marca lo apaga, ocultar los items de
          // reseñas (panel + QR). reviewsEnabled default true.
          const reviewsHidden = tenantInfo.reviewsEnabled === false;
          const reviewHrefs = new Set([
            '/app/reviews',
            '/app/marketing/qr-reviews',
          ]);

          return all
            .map((g) => ({
              ...g,
              items: g.items.filter(
                (it) =>
                  (!it.module || has(it.module)) &&
                  !(reviewsHidden && reviewHrefs.has(it.href)),
              ),
            }))
            .filter((g) => g.items.length > 0);
        })();

  if (!user) return null;

  // Lockscreen: tenant aún no completó el pago. Hay 3 caminos posibles:
  //   1. Trial nuevo (/prueba) activo → trialEndsAt > now → NO lockscreen,
  //      el dueño accede al panel + TrialBanner muestra countdown.
  //   2. Trial nuevo expirado → trialEndsAt < now + sin hotmart code →
  //      TrialExpiredLockscreen ("Tu prueba terminó · Activar").
  //   3. Signup legacy Hotmart (sin trialEndsAt set) → flujo viejo:
  //      CardVerificationLockscreen ("Falta confirmar tu pago").
  // Solo aplica a TENANT_OWNER (staff entra con tenant ya activo) y solo
  // cuando tenantInfo ya cargó (no parpadear lockscreen pre-fetch).
  if (
    variant === 'app' &&
    user.role === 'TENANT_OWNER' &&
    tenantInfo &&
    !tenantInfo.hotmartSubscriberCode &&
    !tenantInfo.whiteLabelCreditsUnlimited &&
    planName === 'Elite'
  ) {
    const trialEnd = tenantInfo.trialEndsAt
      ? new Date(tenantInfo.trialEndsAt)
      : null;
    const trialActive = trialEnd && trialEnd.getTime() > Date.now();
    const trialExpired = trialEnd && trialEnd.getTime() <= Date.now();
    if (trialExpired) {
      return (
        <TrialExpiredLockscreen
          brandName={tenantInfo.brandName}
          trialEndsAt={tenantInfo.trialEndsAt ?? null}
        />
      );
    }
    if (!trialActive) {
      // Sin trial set Y sin hotmart → signup legacy (lockscreen Hotmart).
      return (
        <CardVerificationLockscreen
          brandName={tenantInfo.brandName}
          planName={planName}
        />
      );
    }
    // Trial activo: dejamos pasar al panel. El TrialBanner abajo muestra
    // el countdown de días restantes.
  }

  // Marca blanca activa: branding desde la pila de impersonación (PLATFORM_OWNER
  // que "entró" a una marca) o, en su defecto, resuelto por slug de la URL
  // (login directo a /admin/<slug>). El panel /admin se pinta con esa
  // identidad, NO con la de Clubify.
  // `icon` = logo DASHBOARD cuadrado (preferido para el sidebar); `logo` = logo
  // HEADER ancho (fallback). El render elige según cuál exista para no
  // deformar un lockup ancho dentro de un cuadrado.
  // Marca del panel del NEGOCIO (/app): hereda el branding de la marca blanca
  // del tenant (no Clubify). Solo para marcas ≠ clubify con branding cargado.
  const appWlBrand =
    variant === 'app' &&
    tenantInfo?.whiteLabelSlug &&
    tenantInfo.whiteLabelSlug !== 'clubify' &&
    tenantInfo.whiteLabelBranding
      ? {
          name: tenantInfo.whiteLabelName || tenantInfo.brandName || 'Marca',
          color: tenantInfo.whiteLabelBranding.primaryColor || null,
          icon: tenantInfo.whiteLabelBranding.iconUrl || null,
          logo: tenantInfo.whiteLabelBranding.logoUrl || null,
        }
      : null;

  // Marca del panel /app derivada del SEED de impersonation (leído pre-paint).
  // Se usa mientras /tenants/me aún no responde → evita el flash. Solo marcas
  // ≠ clubify con branding propio (Clubify = verde, es el default correcto).
  const appSeedBrand =
    variant === 'app' &&
    appSeed?.whiteLabelSlug &&
    appSeed.whiteLabelSlug !== 'clubify' &&
    (appSeed.color || appSeed.icon || appSeed.logo)
      ? {
          name: appSeed.name || appSeed.brandName || 'Marca',
          color: appSeed.color || null,
          icon: appSeed.icon || null,
          logo: appSeed.logo || null,
        }
      : null;

  // Marca efectiva del panel /app: lo confirmado por /tenants/me tiene
  // prioridad; si aún no cargó, el seed de impersonation (primer paint).
  const appBrand = appWlBrand ?? appSeedBrand;

  const activeBrand =
    variant === 'app'
      ? appBrand
      : variant !== 'admin'
        ? null
        : impersonation?.tenant?.brandName?.trim()
          ? {
              name: impersonation.tenant.brandName.trim(),
              color: impersonation.tenant.primaryColor || brandFetched?.color || null,
              icon: brandFetched?.iconUrl ?? null,
              logo: brandFetched?.logoUrl ?? null,
            }
          : brandFetched
            ? {
                name: brandFetched.name,
                color: brandFetched.color,
                icon: brandFetched.iconUrl,
                logo: brandFetched.logoUrl,
              }
            : null;

  // (brandSlug + brandModules se declaran arriba, antes de `groups`, para
  // evitar el TDZ — ver comentario allí.)

  // Color de tema del panel: solo para marcas distintas de Clubify con color
  // propio. Inyecta el override que vuelve coral (o lo que sea) todo el verde.
  const panelThemeColor =
    (variant === 'admin' && brandSlug && brandSlug !== 'clubify' && activeBrand?.color
      ? activeBrand.color
      : // Panel del negocio (/app) de una marca blanca → su color propio
        // (confirmado o del seed de impersonation → primer paint sin flash).
        variant === 'app' && appBrand?.color
        ? appBrand.color
        : null) ||
    // Fallback al color resuelto en server (host) → primer paint sin flash.
    serverBrandColor ||
    null;

  // Fondo propio del sidebar (backgroundColor de la marca). Si está definido, el
  // sidebar usa ESE tono (ej. #1A1033) en vez del derivado del acento; si no,
  // queda null → panelBrandCss deriva del acento (comportamiento histórico).
  // Fuente: /admin → brandFetched (branding por slug/host); /app →
  // whiteLabelBranding (/tenants/me); anti-flash SSR → serverBrandBackground.
  const panelSidebarColor =
    (variant === 'admin'
      ? brandFetched?.backgroundColor
      : variant === 'app'
        ? tenantInfo?.whiteLabelBranding?.backgroundColor
        : null) ||
    serverBrandBackground ||
    null;

  // Prefija un href de /admin con el slug de marca activo (/admin/tenants →
  // /admin/<slug>/tenants). El middleware reescribe de vuelta a /admin.
  const brandHref = (href: string) => {
    if (!brandSlug) return href;
    if (href === '/admin') return `/admin/${brandSlug}`;
    if (href.startsWith('/admin/'))
      return `/admin/${brandSlug}${href.slice('/admin'.length)}`;
    return href;
  };

  // Pathname normalizado (sin el prefijo de marca) para detectar el item de
  // nav activo contra los hrefs originales.
  const navPathname =
    brandSlug && pathname.startsWith(`/admin/${brandSlug}`)
      ? '/admin' + pathname.slice(`/admin/${brandSlug}`.length)
      : pathname;

  const brandTitle =
    variant === 'admin'
      ? // Prioridad: marca confirmada por el cliente → marca resuelta en SSR
        //   (host/slug, sin flash) → Clubify.
        activeBrand?.name || serverBrandName || 'Admin Clubify'
      : // Panel /app: nombre del NEGOCIO confirmado → seed de impersonation →
        //   marca por host (SSR) → placeholder.
        tenantInfo?.brandName?.trim() ||
        appSeed?.brandName?.trim() ||
        serverBrandName ||
        'Mi Negocio';

  // Parte B (skeleton neutro): en /app, si el nombre del negocio aún NO se
  // conoce (sin /tenants/me, sin seed, sin marca por host) mostramos un
  // placeholder neutro en vez del texto "Mi Negocio" — que nunca es el nombre
  // real de ningún negocio. Así no se ve una identidad equivocada.
  const appNameLoading =
    variant === 'app' &&
    !tenantInfo?.brandName?.trim() &&
    !appSeed?.brandName?.trim() &&
    !serverBrandName;

  const renderBrandMark = (size: number) => {
    // 1) Logo DASHBOARD cuadrado → caja size×size (encaja perfecto, sin deformar).
    if (activeBrand?.icon) {
      return (
        <img
          src={activeBrand.icon}
          alt={activeBrand.name}
          className="bg-white rounded-input object-contain flex-none"
          style={{ width: size, height: size }}
        />
      );
    }
    // 2) Solo hay logo HEADER (ancho) → render por ALTURA con ancho automático
    //    (NO lo metemos en un cuadrado: un lockup 3:1 se vería diminuto). Se
    //    limita el ancho para no romper el layout del sidebar.
    if (activeBrand?.logo) {
      return (
        <img
          src={activeBrand.logo}
          alt={activeBrand.name}
          className="bg-white rounded-input object-contain flex-none"
          style={{ height: size, width: 'auto', maxWidth: size * 3.4 }}
        />
      );
    }
    // 3) Marca activa sin logo → avatar con su inicial y color (nunca el logo
    //    de Clubify dentro del panel de otra marca).
    if (activeBrand) {
      return (
        <div
          className="rounded-input flex items-center justify-center flex-none font-bold text-white"
          style={{
            width: size,
            height: size,
            background: activeBrand.color || '#16a34a',
            fontSize: Math.round(size * 0.45),
          }}
        >
          {activeBrand.name.charAt(0).toUpperCase()}
        </div>
      );
    }
    // 4) Marca aún no confirmada por el cliente pero resuelta en el SERVIDOR
    //    (host/slug). Usa su logo en el primer paint → sin flash del logo
    //    Clubify. El client-side solo confirma después.
    if (serverBrandLogo) {
      return (
        <img
          src={serverBrandLogo}
          alt={serverBrandName || 'Logo'}
          className="bg-white rounded-input object-contain flex-none"
          style={{ height: size, width: 'auto', maxWidth: size * 3.4 }}
        />
      );
    }
    return branding.appLogoUrl ? (
      <img
        src={branding.appLogoUrl}
        alt="Logo"
        width={size}
        height={size}
        className="bg-white rounded-input object-contain flex-none"
        style={{ width: size, height: size }}
      />
    ) : (
      <Logo variant="mark" size={size} className="bg-white" />
    );
  };

  const sidebar = (
    <aside className="bg-sidebar-bg text-sidebar-ink p-4 flex flex-col gap-1.5 h-full w-[260px] lg:w-[240px] flex-none">
      <div className="flex items-center gap-3 px-1.5 pt-2 pb-4">
        {renderBrandMark(42)}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-[15px] leading-tight truncate">
            {appNameLoading ? (
              <span className="inline-block h-3.5 w-28 max-w-full rounded bg-white/20 animate-pulse align-middle" />
            ) : (
              brandTitle
            )}
          </div>
          <div className="text-[11px] text-sidebar-mute">Panel de Control</div>
        </div>
        <button
          onClick={() => setNavOpen(false)}
          className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-sidebar-mute hover:bg-sidebar-hover hover:text-white transition"
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      {/* Switcher de subcuentas — solo super admin */}
      {variant === 'admin' && (
        <div className="px-1.5 pb-3">
          <TenantSwitcher />
        </div>
      )}

      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {(() => {
          // Mantenemos una lista actualizada de nombres de sección para
          // que toggleSection sepa cuáles colapsar al primer click.
          sectionNamesRef.current = groups.map((g) => g.section).filter(Boolean);
          return null;
        })()}
        {(() => {
          // Calcula el href más específico que matchea el pathname.
          // Si dos items (parent y child) ambos matchean, solo el child
          // queda activo. Evita el bug "Agenda" + "Eventos" iluminadas
          // al estar en /app/reservations/eventos.
          // Inline en lugar de useMemo porque groups se recalcula cada
          // render y la lista es chica (~30 items).
          const allHrefs = groups.flatMap((g) => g.items.map((n) => n.href));
          bestActiveHrefRef.current = findBestActiveHref(allHrefs, navPathname);
          return null;
        })()}
        {groups.map((g, gi) => {
          const bestActiveHref = bestActiveHrefRef.current;
          // Si el path activo está dentro de esta sección, fuerza expand para
          // que el usuario vea dónde está parado.
          const hasActive = g.items.some((n) => n.href === bestActiveHref);
          // Default cerrado si el user nunca tocó nada (hasUserPref=false).
          // Si ya tiene preferencia, respetamos el set guardado.
          const collapsed =
            !hasActive &&
            (hasUserPref ? collapsedSections.has(g.section) : true);
          // Sección sin nombre = items principales sin header colapsable.
          const noHeader = !g.section;

          return (
            <div key={g.section || `_${gi}`}>
              {!noHeader && (
                <button
                  type="button"
                  onClick={() => toggleSection(g.section)}
                  className="w-full text-left text-[10px] tracking-[0.18em] uppercase text-sidebar-section font-semibold opacity-85 pt-3.5 px-3 pb-1.5 flex items-center justify-between hover:opacity-100 transition"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {g.section}
                    {g.badge && (
                      <span
                        className="text-[8px] font-extrabold px-1.5 py-0.5 rounded tracking-wider"
                        style={{ background: '#22C55E', color: 'white' }}
                      >
                        {g.badge}
                      </span>
                    )}
                  </span>
                  <span className="text-[9px] opacity-60">
                    {collapsed ? '▸' : '▾'}
                  </span>
                </button>
              )}
              {(noHeader || !collapsed) &&
                g.items.map((n) => {
                  // Active solo si este es el href más específico que
                  // matchea el pathname (no si es solo prefijo).
                  const active = !n.external && n.href === bestActiveHref;
                  const className = `flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[13.5px] transition cursor-pointer ${
                    active
                      ? 'bg-sidebar-active text-white shadow-active'
                      : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
                  }`;
                  // Links externos (Tutoriales/Academia) abren en nueva pestaña.
                  if (n.external) {
                    return (
                      <a
                        key={n.href}
                        href={brandHref(n.href)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={className}
                      >
                        <Icon
                          name={n.icon}
                          size={18}
                          className="opacity-90 flex-none"
                        />
                        <span>{n.label}</span>
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={n.href}
                      href={brandHref(n.href)}
                      className={className}
                    >
                      <Icon
                        name={n.icon}
                        size={18}
                        className="opacity-90 flex-none"
                      />
                      <span className="flex-1">{n.label}</span>
                      {n.badge && (
                        <span className="flex-none text-[10px] font-bold leading-none px-1.5 py-1 rounded-full bg-amber-400 text-amber-950">
                          {n.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 px-2 pt-4 pb-1 border-t border-[#172534]">
        <div className={`avatar ${avatarColor(user.email || 'X')}`}>
          {initials(user.fullName || user.email || 'U')}
        </div>
        <div className="text-[13px] text-white font-semibold leading-tight flex-1 min-w-0">
          <div className="truncate">{user.fullName || 'Usuario'}</div>
          <small className="block text-sidebar-mute font-normal text-[11px] mt-0.5 truncate">
            {user.email}
          </small>
        </div>
        {variant === 'app' && <NotificationBell />}
        <button
          onClick={() => {
            clearSession();
            router.push('/login');
          }}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sidebar-mute hover:bg-sidebar-hover hover:text-white transition flex-none"
          title="Cerrar sesión"
        >
          <Icon name="out" size={16} />
        </button>
      </div>
    </aside>
  );

  return (
    <div className={`min-h-screen bg-bg ${panelThemeColor ? 'brand-panel' : ''}`}>
      {panelThemeColor && (
        <style dangerouslySetInnerHTML={{ __html: panelBrandCss(panelThemeColor, panelSidebarColor) }} />
      )}
      {/* Sidebar fijo en lg+, drawer overlay en mobile */}
      <div className="hidden lg:flex fixed inset-y-0 left-0">{sidebar}</div>

      {/* Drawer mobile */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setNavOpen(false)}
          />
          <div className="relative shadow-2xl">{sidebar}</div>
        </div>
      )}

      {/* Topbar mobile (con botón hamburger) */}
      <header className="lg:hidden sticky top-0 z-30 bg-sidebar-bg text-white px-4 py-3 flex items-center gap-3 border-b border-[#172534]">
        <button
          onClick={() => setNavOpen(true)}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-sidebar-hover transition"
          title="Menú"
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {renderBrandMark(28)}
          <div className="font-semibold text-sm truncate">
            {appNameLoading ? (
              <span className="inline-block h-3 w-24 max-w-full rounded bg-white/25 animate-pulse align-middle" />
            ) : (
              brandTitle
            )}
          </div>
        </div>
        {variant === 'app' && <NotificationBell />}
      </header>

      {/* Contenido */}
      <div className="lg:ml-[240px] min-w-0">
        {/* Banner cuando un admin (SUPER_ADMIN) impersona un tenant — variant=app */}
        {variant === 'app' && impersonation && impersonation.user?.role !== 'PLATFORM_OWNER' && (
          <div className="bg-amber-500 text-amber-950 px-4 py-2 text-[13px] flex items-center gap-2 flex-wrap">
            <span className="font-semibold">🛡 Modo admin</span>
            <span className="opacity-80">
              Estás dentro de <b>{impersonation.tenant?.brandName ?? 'este negocio'}</b> como{' '}
              {impersonation.user?.email ?? 'super admin'}.
            </span>
            <button
              onClick={() => {
                stopImpersonation();
                router.push('/admin');
              }}
              className="ml-auto bg-amber-950 text-amber-100 px-3 py-1 rounded-md text-xs font-semibold hover:bg-amber-900 transition"
              title="Volver al admin (desde ahí puedes cambiar de subcuenta con el switcher del sidebar)"
            >
              ← Volver al admin
            </button>
          </div>
        )}
        {/* Banner cuando un PLATFORM_OWNER impersona una marca — visible en admin y app */}
        {impersonation && impersonation.user?.role === 'PLATFORM_OWNER' && (
          <div className="bg-emerald-700 text-emerald-50 px-4 py-2 text-[13px] flex items-center gap-2 flex-wrap">
            <span className="font-semibold">🏛 Modo plataforma · Fidelity</span>
            <span className="opacity-90">
              Estás dentro de <b>{impersonation.tenant?.brandName ?? 'esta marca'}</b> como super admin.
            </span>
            <button
              onClick={() => {
                stopImpersonation();
                router.push('/superadmin');
              }}
              className="ml-auto bg-emerald-900 text-emerald-100 px-3 py-1 rounded-md text-xs font-semibold hover:bg-emerald-950 transition"
              title="Volver al panel de Fidelity"
            >
              ← Volver a Fidelity
            </button>
          </div>
        )}
        {variant === 'app' && tenantInfo?.isLocked && (
          <div className="bg-violet-600 text-white px-4 py-2 text-[13px] flex items-center gap-2 flex-wrap">
            <span className="font-semibold">🔒 Cuenta demo · solo lectura</span>
            <span className="opacity-90">
              Esta cuenta está bloqueada para demostración. Puedes navegar todo el panel
              pero no se puede modificar ni eliminar contenido.
            </span>
          </div>
        )}
        {variant === 'app' && <TrialBanner />}
        {/* Topbar desktop con CommandHint a la derecha */}
        <div className="hidden lg:flex items-center justify-end gap-3 px-7 pt-4">
          <CommandHint />
        </div>
        <main className="bg-bg p-4 sm:p-6 lg:p-7 lg:pt-4">{children}</main>
      </div>

      <CommandPalette variant={variant} />
      {variant === 'app' && (
        <>
          {/* Asistente IA: solo en negocios de Clubify. Su prompt/knowledge
              habla de Clubify, así que NO se muestra en negocios de otras
              marcas blancas (Sellea, etc.). */}
          {(!tenantInfo?.whiteLabelSlug || tenantInfo.whiteLabelSlug === 'clubify') && (
            <SupportWidget brandName={tenantInfo?.whiteLabelName ?? undefined} />
          )}
          <QuickCreateFAB />
        </>
      )}
      {/* Difusión interna: popup global de comunicación. El componente
          consulta el endpoint por su cuenta y solo se muestra si hay
          una pieza pendiente para este user. */}
      <LoginPopupBroadcast />
    </div>
  );
}
