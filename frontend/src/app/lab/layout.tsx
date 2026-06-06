'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearSession, getUser } from '@/lib/api';
import { Logo } from '@/components/Logo';

/**
 * Layout standalone para /lab. No usa AppShell porque Clubify Lab es
 * accesible para múltiples roles (TENANT_OWNER, AFFILIATE_*, SUPER_ADMIN,
 * MARKETING) — cada uno con su sidebar distinto. Acá usamos un header
 * propio simple con link "Volver al panel" según el rol.
 */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login?next=/lab');
      return;
    }
    setUser(u);
  }, [router]);

  if (!user) return null;

  const backHref = (() => {
    if (user.role === 'SUPER_ADMIN' || user.role === 'MARKETING') return '/admin';
    if (user.role === 'TENANT_OWNER' || user.role === 'TENANT_STAFF') return '/app';
    if (String(user.role).startsWith('AFFILIATE_')) return '/affiliate';
    return '/app';
  })();

  return (
    <div className="min-h-dvh bg-bg2">
      <header className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-sm text-mute2 hidden sm:inline">/</span>
            <Link
              href="/lab"
              className="text-sm font-semibold text-ink hover:text-brand transition"
            >
              Clubify Lab
            </Link>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={backHref}
              className="text-mute hover:text-ink transition px-3 py-1.5 rounded-full"
            >
              Volver al panel
            </Link>
            <button
              type="button"
              onClick={() => {
                clearSession();
                router.replace('/login');
              }}
              className="text-mute2 hover:text-bad transition px-3 py-1.5 rounded-full"
            >
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
