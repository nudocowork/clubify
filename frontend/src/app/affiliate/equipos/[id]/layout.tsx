'use client';

/**
 * Un equipo de ventas visto desde el panel del afiliado.
 *
 * Estas rutas montan LAS MISMAS pantallas que el admin —las de
 * `/admin/sales-teams/[id]`— y sus enlaces internos se quedan en este panel
 * solos (`useBaseDeEquipos`). Aquí solo se añade la barra de arriba del panel del
 * afiliado. Quién entra lo sigue decidiendo el servidor: `resolveTeamAccess`
 * exige ser miembro activo del equipo.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { clearSession } from '@/lib/api';
import { Logo } from '@/components/Logo';

export default function EquipoDelAfiliadoLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  function salir() {
    clearSession();
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white px-5 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/affiliate/equipos" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="hidden text-sm font-semibold sm:inline">← Mis equipos</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/affiliate" className="text-xs text-mute hover:text-ink">
              Panel afiliado
            </Link>
            <button type="button" onClick={salir} className="text-xs text-mute hover:text-ink">
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">{children}</main>
    </div>
  );
}
