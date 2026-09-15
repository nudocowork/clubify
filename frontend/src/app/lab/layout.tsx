'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearSession, getUser } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { authBrandCss } from '@/lib/panel-brand-theme';
import { colorDeMarca } from './_shared';
import { useLabContexto } from './useLabContexto';

/**
 * Layout standalone para /lab. No usa AppShell porque el Lab es accesible para
 * múltiples roles (TENANT_OWNER, AFFILIATE_*, SUPER_ADMIN, MARKETING) — cada
 * uno con su sidebar distinto. Acá usamos un header propio simple con link
 * "Volver al panel" según el rol.
 *
 * La cabecera se pinta con la marca de quien mira (`/lab/me`): el logo de
 * Clubify y el «Clubify Lab» fijos se le enseñaban también al administrador de
 * una marca blanca. Mientras no se sabe la marca no se pinta logo ni nombre.
 */
export default function LabLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  // Sin sesión no se pregunta: el efecto de abajo manda al login.
  const lab = useLabContexto(!!user);

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

  const contexto = lab.estado === 'listo' ? lab.contexto : null;
  const nombre = contexto?.marca?.name?.trim() || null;
  const deMarca = contexto?.alcance === 'MARCA_ADMIN';
  const logoMarca = deMarca ? contexto?.marca?.logoUrl || null : null;
  const color = deMarca ? colorDeMarca(contexto?.marca?.primaryColor) : null;

  return (
    <div className="min-h-dvh bg-bg2 brand-auth">
      {/* Tema de la marca blanca: botones, pestañas y verdes de Clubify pasan a su color. */}
      {color && <style dangerouslySetInnerHTML={{ __html: authBrandCss(color) }} />}
      <header className="bg-white border-b border-line">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {contexto && !deMarca && <Logo />}
            {logoMarca && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoMarca} alt={nombre ?? ''} className="h-8 w-auto" />
            )}
            {((contexto && !deMarca) || logoMarca) && (
              <span className="text-sm text-mute2 hidden sm:inline">/</span>
            )}
            <Link
              href="/lab"
              className="text-sm font-semibold text-ink hover:text-brand transition"
            >
              {nombre ? `${nombre} Lab` : 'Lab'}
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
