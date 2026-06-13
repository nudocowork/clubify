'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { clearSession, getUser } from '@/lib/api';

const NAV_GROUPS: { label: string; items: { href: string; label: string; icon: string; badge?: number }[] }[] = [
  {
    label: 'GENERAL',
    items: [
      { href: '/superadmin', label: 'Dashboard', icon: '▦' },
      { href: '/superadmin/marcas', label: 'Marcas Blancas', icon: '🏛' },
    ],
  },
  {
    label: 'OPERACIÓN',
    items: [
      { href: '/superadmin/creditos', label: 'Centro de Créditos', icon: '💳' },
      { href: '/superadmin/cobros', label: 'Centro de Cobros', icon: '🧾' },
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

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== 'PLATFORM_OWNER') {
      router.replace('/login');
      return;
    }
    setUser(u);
  }, [router]);

  if (!user) return null;

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
          background: 'linear-gradient(176deg, #1a5c38 0%, #11442a 46%, #0a2c1a 100%)',
          color: 'white',
          position: 'sticky',
          top: 0,
          maxHeight: '100vh',
        }}
      >
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/15 text-base"
              style={{ fontWeight: 800 }}
            >
              🏠
            </div>
            <div className="min-w-0">
              <div className="font-extrabold text-base leading-tight">Fidelia</div>
              <div className="text-[10.5px] opacity-70 leading-snug">
                Software de Fidelización · Super Admin
              </div>
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
                            background: '#22c55e',
                            color: 'white',
                            fontWeight: 600,
                            boxShadow: '0 6px 14px rgba(34,197,94,.35)',
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
