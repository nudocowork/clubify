'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, clearSession, getUser, getImpersonationBackup, stopImpersonation } from '@/lib/api';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';
import { TrialBanner } from './TrialBanner';
import { CommandPalette, CommandHint } from './CommandPalette';
import { QuickCreateFAB } from './QuickCreateFAB';
import { CardVerificationLockscreen } from './CardVerificationLockscreen';
import { Logo } from './Logo';
import { TenantSwitcher } from './TenantSwitcher';
import { SupportWidget } from './SupportWidget';
import { useBranding } from '@/lib/useBranding';
import {
  getCategoryBySlug,
  catalogItemLabel,
  type BusinessModule,
} from '@/lib/business-categories';

type IconName = Parameters<typeof Icon>[0]['name'];
type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** Si está seteado, el item solo se muestra si la categoría del negocio
   *  habilita ese módulo. Sin module = visible siempre. */
  module?: BusinessModule;
};
type NavGroup = { section: string; items: NavItem[] };

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

export default function AppShell({
  variant,
  children,
}: {
  variant: 'admin' | 'app';
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const branding = useBranding();
  const [user, setUser] = useState<any>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [impersonation, setImpersonation] = useState<ReturnType<typeof getImpersonationBackup>>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [tenantInfo, setTenantInfo] = useState<{
    brandName?: string;
    hotmartSubscriberCode?: string | null;
    businessCategorySlug?: string | null;
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
    if (variant === 'admin' && u.role !== 'SUPER_ADMIN') router.push('/app');
    if (variant === 'app' && u.role === 'SUPER_ADMIN') router.push('/admin');
    setUser(u);
  }, [router, variant]);

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
        });
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

  const groups: NavGroup[] =
    variant === 'admin'
      ? [
          {
            section: 'Principal',
            items: [
              { href: '/admin', label: 'Dashboard', icon: 'grid' },
              { href: '/admin/tenants', label: 'Negocios', icon: 'store' },
            ],
          },
          {
            section: 'Programa',
            items: [
              { href: '/admin/referrals', label: 'Referidos', icon: 'gift' },
              { href: '/admin/support-materials', label: 'Material de apoyo', icon: 'spark' },
            ],
          },
          {
            section: 'Ventas',
            items: [
              { href: '/admin/cotizaciones', label: 'Cotizaciones', icon: 'clipboard' },
            ],
          },
          {
            section: 'Sistema',
            items: [
              { href: '/admin/business-categories', label: 'Categorías', icon: 'grid' },
              { href: '/admin/ai-knowledge', label: 'IA · Knowledge', icon: 'spark' },
              { href: '/admin/branding', label: 'Branding', icon: 'spark' },
              { href: '/admin/maintenance', label: 'Mantenimiento', icon: 'grid' },
              { href: '/admin/audit', label: 'Audit log', icon: 'history' },
            ],
          },
        ]
      : (() => {
          const catSlug = tenantInfo?.businessCategorySlug;
          const cat = getCategoryBySlug(catSlug);
          const has = (m: BusinessModule) => cat.modules.includes(m);
          const menuLabel = catalogItemLabel(catSlug);
          // El nombre de la sección "Menú digital" cambia según el rubro:
          // 'menu' → "Menú digital", 'catalog' → "Catálogo", 'services' → "Servicios"
          const catalogSectionName =
            cat.catalogLabel === 'services'
              ? 'Servicios'
              : cat.catalogLabel === 'catalog'
              ? 'Catálogo'
              : 'Menú digital';

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
                { href: '/app/notifications', label: 'Push', icon: 'bell', module: 'push' },
                { href: '/app/reviews', label: 'Reseña de Google', icon: 'spark' },
              ],
            },
            {
              section: 'Marketing',
              items: [
                { href: '/app/marketing/qr-menu', label: 'QR Menú', icon: 'menu', module: 'menu' },
                { href: '/app/marketing/qr-counter', label: 'QR Mostrador', icon: 'card' },
                { href: '/app/marketing/qr-discount', label: 'QR Descuento', icon: 'gift' },
                { href: '/app/marketing/qr-reviews', label: 'QR Reseñas', icon: 'spark' },
              ],
            },
            {
              section: catalogSectionName,
              items: [
                { href: '/app/menu', label: menuLabel, icon: 'menu', module: 'menu' },
                { href: '/app/translations', label: 'Traducciones', icon: 'spark' },
                { href: '/app/orders', label: 'Pedidos', icon: 'shopping-bag', module: 'orders' },
                { href: '/app/analytics', label: 'Analítica', icon: 'history', module: 'analytics' },
              ],
            },
            {
              section: 'Administrativo',
              items: [
                { href: '/app/admin/reminders', label: 'Recordatorios', icon: 'clipboard' },
                { href: '/app/admin/orders', label: 'Pedidos a proveedores', icon: 'truck' },
              ],
            },
            {
              section: 'Cuenta',
              items: [
                { href: '/app/staff', label: 'Equipo de trabajo', icon: 'users', module: 'staff' },
                { href: '/app/billing', label: 'Suscripción', icon: 'card' },
                { href: '/app/settings', label: 'Configuraciones', icon: 'gear' },
                { href: '/app/referrals', label: 'Referidos', icon: 'gift' },
                { href: '/app/whats-new', label: 'Novedades', icon: 'bell' },
              ],
            },
          ];

          // Mientras tenantInfo no llegó (primer paint), mostramos todos los
          // items para no flickear. Una vez carga, se filtran.
          if (!tenantInfo) return all;

          return all
            .map((g) => ({
              ...g,
              items: g.items.filter((it) => !it.module || has(it.module)),
            }))
            .filter((g) => g.items.length > 0);
        })();

  if (!user) return null;

  // Lockscreen: tenant aún no completó la verificación de tarjeta en Hotmart.
  // Aplica solo a TENANT_OWNER (los staff entran con tenant ya activo) y solo
  // si ya tenemos data del tenant cargada (no parpadear lockscreen mientras
  // /tenants/me responde).
  if (
    variant === 'app' &&
    user.role === 'TENANT_OWNER' &&
    tenantInfo &&
    !tenantInfo.hotmartSubscriberCode &&
    planName === 'Elite'
  ) {
    return (
      <CardVerificationLockscreen
        brandName={tenantInfo.brandName}
        planName={planName}
      />
    );
  }

  const brandTitle =
    variant === 'admin'
      ? 'Admin Clubify'
      : tenantInfo?.brandName?.trim() || 'Mi Negocio';

  const renderBrandMark = (size: number) =>
    branding.appLogoUrl ? (
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

  const sidebar = (
    <aside className="bg-sidebar-bg text-sidebar-ink p-4 flex flex-col gap-1.5 h-full w-[260px] lg:w-[240px] flex-none">
      <div className="flex items-center gap-3 px-1.5 pt-2 pb-4">
        {renderBrandMark(42)}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-[15px] leading-tight truncate">
            {brandTitle}
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
        {groups.map((g, gi) => {
          // Si el path activo está dentro de esta sección, fuerza expand para
          // que el usuario vea dónde está parado.
          const hasActive = g.items.some((n) => isHrefActive(n.href, pathname));
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
                  <span>{g.section}</span>
                  <span className="text-[9px] opacity-60">
                    {collapsed ? '▸' : '▾'}
                  </span>
                </button>
              )}
              {(noHeader || !collapsed) &&
                g.items.map((n) => {
                  const active = isHrefActive(n.href, pathname);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[13.5px] transition cursor-pointer ${
                        active
                          ? 'bg-sidebar-active text-white shadow-active'
                          : 'text-gray-300 hover:bg-sidebar-hover hover:text-white'
                      }`}
                    >
                      <Icon
                        name={n.icon}
                        size={18}
                        className="opacity-90 flex-none"
                      />
                      <span>{n.label}</span>
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
    <div className="min-h-screen bg-bg">
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
          <div className="font-semibold text-sm truncate">{brandTitle}</div>
        </div>
        {variant === 'app' && <NotificationBell />}
      </header>

      {/* Contenido */}
      <div className="lg:ml-[240px] min-w-0">
        {variant === 'app' && impersonation && (
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
          <SupportWidget />
          <QuickCreateFAB />
        </>
      )}
    </div>
  );
}
