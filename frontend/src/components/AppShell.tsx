'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearSession, getUser } from '@/lib/api';
import { Icon } from './Icon';
import { NotificationBell } from './NotificationBell';

type IconName = Parameters<typeof Icon>[0]['name'];
type NavItem = { href: string; label: string; icon: IconName };
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

export default function AppShell({
  variant,
  children,
}: {
  variant: 'admin' | 'app';
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    if (variant === 'admin' && u.role !== 'SUPER_ADMIN') router.push('/app');
    if (variant === 'app' && u.role === 'SUPER_ADMIN') router.push('/admin');
    setUser(u);
  }, [router, variant]);

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
            ],
          },
          {
            section: 'Sistema',
            items: [
              { href: '/admin/audit', label: 'Audit log', icon: 'history' },
            ],
          },
        ]
      : [
          {
            section: 'Vender',
            items: [
              { href: '/app', label: 'Dashboard', icon: 'grid' },
              { href: '/app/orders', label: 'Pedidos', icon: 'shopping-bag' },
              { href: '/app/menu', label: 'Menú', icon: 'menu' },
              { href: '/app/promos', label: 'Promociones', icon: 'spark' },
              { href: '/app/analytics', label: 'Analítica', icon: 'history' },
            ],
          },
          {
            section: 'Fidelizar',
            items: [
              { href: '/app/cards', label: 'Tarjetas', icon: 'card' },
              { href: '/app/customers', label: 'Clientes', icon: 'users' },
              { href: '/scan', label: 'Escáner', icon: 'qr' },
            ],
          },
          {
            section: 'Automatizar',
            items: [
              { href: '/app/messages', label: 'Mensajes', icon: 'send' },
              { href: '/app/automations', label: 'Automatizaciones', icon: 'spark' },
              { href: '/app/notifications', label: 'Push', icon: 'bell' },
            ],
          },
          {
            section: 'Tu sitio',
            items: [
              { href: '/app/storefront', label: 'Mi sitio', icon: 'store' },
              { href: '/app/info-links', label: 'Links informativos', icon: 'arrow-right' },
              { href: '/app/locations', label: 'Ubicaciones', icon: 'pin' },
              { href: '/app/referrals', label: 'Referidos', icon: 'gift' },
            ],
          },
          {
            section: 'Equipo',
            items: [
              { href: '/app/staff', label: 'Empleados', icon: 'users' },
            ],
          },
        ];

  if (!user) return null;

  const brandTitle = variant === 'admin' ? 'Admin Clubify' : 'Mi Negocio';
  const brandColor = variant === 'admin' ? 'bg-brand' : 'bg-avatar-1';

  const sidebar = (
    <aside className="bg-sidebar-bg text-sidebar-ink p-4 flex flex-col gap-1.5 h-full w-[260px] lg:w-[240px] flex-none">
      <div className="flex items-center gap-3 px-1.5 pt-2 pb-4">
        <div
          className={`${brandColor} w-[42px] h-[42px] rounded-[10px] flex items-center justify-center text-white font-bold text-lg tracking-tight`}
        >
          C
        </div>
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

      <div className="flex-1 overflow-y-auto -mx-1 px-1">
        {groups.map((g) => (
          <div key={g.section}>
            <div className="text-[10px] tracking-[0.18em] uppercase text-sidebar-section font-semibold opacity-85 pt-3.5 px-3 pb-1.5">
              {g.section}
            </div>
            {g.items.map((n) => {
              const active =
                pathname === n.href || pathname.startsWith(n.href + '/');
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
                  <Icon name={n.icon} size={18} className="opacity-90 flex-none" />
                  {n.label}
                </Link>
              );
            })}
          </div>
        ))}
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
          <div
            className={`${brandColor} w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-none`}
          >
            C
          </div>
          <div className="font-semibold text-sm truncate">{brandTitle}</div>
        </div>
        {variant === 'app' && <NotificationBell />}
      </header>

      {/* Contenido */}
      <main className="lg:ml-[240px] bg-bg p-4 sm:p-6 lg:p-7 min-w-0">
        {children}
      </main>
    </div>
  );
}
