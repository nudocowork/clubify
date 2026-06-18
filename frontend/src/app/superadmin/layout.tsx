'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { api, clearSession, getUser } from '@/lib/api';

type Badges = { whiteLabels?: number; billing?: number };

type NavItem = { href: string; label: string; icon: string; badge?: number };
type NavGroup = { label: string; items: NavItem[] };

function buildNavGroups(badges: Badges): NavGroup[] {
  return [
    {
      label: 'GENERAL',
      items: [
        { href: '/superadmin', label: 'Dashboard', icon: '▦' },
        { href: '/superadmin/marcas', label: 'Marcas Blancas', icon: '🏛', badge: badges.whiteLabels },
      ],
    },
    {
      label: 'OPERACIÓN',
      items: [
        { href: '/superadmin/creditos', label: 'Centro de Créditos', icon: '💳' },
        { href: '/superadmin/cobros', label: 'Centro de Cobros', icon: '🧾', badge: badges.billing },
        { href: '/superadmin/modulos', label: 'Módulos', icon: '⊞' },
      ],
    },
    {
      label: 'PLATAFORMA',
      items: [
        { href: '/superadmin/integraciones', label: 'Integraciones', icon: '🔌' },
        { href: '/superadmin/historial', label: 'Historial', icon: '🕒' },
        { href: '/superadmin/configuracion', label: 'Configuración', icon: '⚙' },
      ],
    },
  ];
}

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [badges, setBadges] = useState<Badges>({});
  // #2: branding configurable del Master Admin (nombre/tagline/logo/color)
  // desde /superadmin/configuracion. Sin hardcodes.
  const [cfg, setCfg] = useState<{ name: string; tagline: string; logoUrl: string; primaryColor: string } | null>(null);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'PLATFORM_OWNER') {
      router.replace('/login');
      return;
    }
    setUser(u);
    api<Badges>('/superadmin/sidebar-badges')
      .then(setBadges)
      .catch(() => null);
    api<{ name: string; tagline: string; logoUrl: string; primaryColor: string }>('/superadmin/config')
      .then(setCfg)
      .catch(() => null);
  }, [router]);

  if (!user) return null;
  const NAV_GROUPS = buildNavGroups(badges);
  const brandName = cfg?.name || 'Fidelia';
  const brandTagline = cfg?.tagline || 'Software de Fidelización · Super Admin';
  const brandLogo = cfg?.logoUrl || '';
  const pc = cfg?.primaryColor || '#22c55e';

  function isActive(href: string) {
    if (href === '/superadmin') return pathname === '/superadmin';
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <div className="flex min-h-screen" style={{ background: '#f4f5f7', fontFamily: '"Figtree", system-ui, sans-serif' }}>
      <aside
        className="flex flex-col"
        style={{
          width: 250,
          minHeight: '100vh',
          // #2: gradiente derivado del color primario configurado (sin verde
          // hardcodeado). color-mix oscurece el color para el degradado.
          background: `linear-gradient(176deg, color-mix(in srgb, ${pc} 78%, #0a0a0f) 0%, color-mix(in srgb, ${pc} 32%, #0a0a0f) 55%, #0a0a0f 100%)`,
          color: 'white',
          position: 'sticky',
          top: 0,
          maxHeight: '100vh',
        }}
      >
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-base overflow-hidden"
              style={{ fontWeight: 800, background: brandLogo ? '#fff' : 'rgba(255,255,255,.15)' }}
            >
              {brandLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brandLogo} alt={brandName} className="w-full h-full object-contain" />
              ) : (
                brandName[0]?.toUpperCase() || '🏠'
              )}
            </div>
            <div className="min-w-0">
              <div className="font-extrabold text-base leading-tight truncate">{brandName}</div>
              <div className="text-[10.5px] opacity-70 leading-snug">{brandTagline}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mb-3">
              <div
                className="px-3 pb-1.5 pt-2 text-[10.5px] font-bold uppercase"
                style={{ letterSpacing: 1, color: 'rgba(255,255,255,.4)' }}
              >
                {g.label}
              </div>
              {g.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block px-3 py-2.5 rounded-[10px] text-[13.5px] flex items-center justify-between gap-2 transition mb-0.5"
                    style={
                      active
                        ? {
                            background: pc,
                            color: 'white',
                            fontWeight: 600,
                            boxShadow: `0 6px 14px ${pc}59`,
                          }
                        : { color: 'rgba(255,255,255,0.88)' }
                    }
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.07)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="text-base leading-none w-5 text-center">{item.icon}</span>
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className="text-[11px] font-bold px-2 rounded-full"
                        style={{ background: 'rgba(255,255,255,.2)' }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-3 pb-4 border-t border-white/10 pt-3 mt-2">
          <div className="flex items-center gap-2 px-1">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ background: 'rgba(255,255,255,.15)' }}
            >
              {(user.fullName || user.email)?.[0]?.toUpperCase() ?? 'P'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">
                {user.fullName ?? user.email}
              </div>
              <div className="text-[10.5px] opacity-70">Super Administrador</div>
            </div>
            <button
              onClick={() => {
                clearSession();
                router.replace('/login');
              }}
              className="opacity-70 hover:opacity-100"
              title="Salir"
            >
              ⇥
            </button>
          </div>
        </div>
      </aside>

      <main
        className="flex-1 overflow-y-auto"
        style={{ padding: '26px 32px 60px', maxWidth: 1500 }}
      >
        {children}
      </main>
    </div>
  );
}
