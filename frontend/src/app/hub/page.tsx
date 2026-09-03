'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearSession, getUser } from '@/lib/api';
import { modulesForUser, primaryHrefForUser, type AppModule } from '@/lib/modules';
import { useAuthBrand, BrandMark, BrandAuthTheme } from '@/components/AuthBrand';
import { useBranding } from '@/lib/useBranding';

/**
 * Lanzador: según el correo con el que se inició sesión, muestra los módulos
 * a los que esa cuenta tiene acceso. Es la pantalla de entrada de las apps de
 * iOS/Android; en el navegador se llega por /hub o al cambiar de módulo.
 *
 * Con un solo módulo no tiene sentido pedir un clic de más: entra directo.
 */
export default function HubPage() {
  const router = useRouter();
  const { brand } = useAuthBrand();
  // En el dominio de Clubify, useAuthBrand devuelve null a propósito (no hay
  // marca blanca) y BrandMark cae al PNG estático del repo, que es el logo
  // VIEJO de la 'C'. El logo real se configura en /admin/branding y es de
  // donde ya lo saca el panel — así el lanzador y el panel muestran lo mismo.
  const branding = useBranding();
  const [user, setUser] = useState<{ email?: string; name?: string; role?: string } | null>(null);
  const [modules, setModules] = useState<AppModule[]>([]);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    const mods = modulesForUser(u);
    if (mods.length <= 1) {
      router.replace(primaryHrefForUser(u));
      return;
    }
    setUser(u);
    setModules(mods);
  }, [router]);

  function salir() {
    clearSession();
    router.replace('/login');
  }

  // Mientras resuelve el rol no pintamos nada: cualquier esqueleto aquí
  // aparecería y desaparecería en el caso mayoritario (un solo módulo →
  // redirect inmediato).
  if (!user || modules.length === 0) return null;

  return (
    <div
      className="min-h-screen bg-bg"
      style={{
        paddingTop: 'max(24px, env(safe-area-inset-top))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
      }}
    >
      <BrandAuthTheme brand={brand} />
      <div className="mx-auto w-full max-w-3xl px-5">
        <header className="flex items-center justify-between gap-3 mb-8">
          {brand ? (
            <BrandMark brand={brand} size={30} />
          ) : branding.appLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.appLogoUrl}
              alt="Clubify"
              style={{ height: 34, width: 'auto', maxWidth: 150, objectFit: 'contain' }}
            />
          ) : (
            <BrandMark brand={null} size={30} />
          )}
          <button
            onClick={salir}
            className="text-xs text-mute hover:text-ink underline underline-offset-2"
          >
            Cerrar sesión
          </button>
        </header>

        <h1 className="text-[22px] font-extrabold text-ink leading-tight">
          {user.name ? `Hola, ${user.name}` : 'Hola'}
        </h1>
        <p className="text-sm text-mute mt-1 mb-7 break-all">
          {user.email} · elige a dónde entrar
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {modules.map((m) => (
            <Link
              key={m.key}
              href={m.href}
              className="group flex items-start gap-3 rounded-2xl bg-surface border border-line p-4 transition hover:border-transparent hover:shadow-[0_8px_24px_rgba(15,23,42,.10)]"
            >
              <span
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
                style={{ background: `${m.accent}1A` }}
                aria-hidden
              >
                {m.emoji}
              </span>
              <span className="min-w-0">
                <span className="block font-bold text-ink text-[15px] leading-tight">
                  {m.label}
                </span>
                <span className="block text-[12.5px] text-mute leading-snug mt-1">
                  {m.description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
