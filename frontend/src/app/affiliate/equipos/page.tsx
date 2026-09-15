'use client';

/**
 * «Equipos de ventas» en el panel del afiliado: los equipos de la marca en los
 * que esta persona es colaboradora.
 *
 * Los colaboradores de un equipo son afiliados y el panel de admin no los deja
 * entrar. Javier eligió (2026-09-14) que trabajen su equipo desde aquí: cada
 * tarjeta abre las mismas pestañas que ve el admin. Quién entra a cada una lo
 * sigue decidiendo el servidor (miembro activo del equipo).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession } from '@/lib/api';
import { Logo } from '@/components/Logo';

type Equipo = { id: string; nombre: string; color: string | null; roles: string[] };

const ROL: Record<string, string> = {
  lider: 'Líder',
  closer: 'Closer',
  setter: 'Setter',
  lectura: 'Solo lectura',
};

export default function MisEquiposDeVentasPage() {
  const router = useRouter();
  const [equipos, setEquipos] = useState<Equipo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ equipos: Equipo[] }>('/sales-teams/mios')
      .then((r) => setEquipos(r.equipos))
      .catch((e: any) => {
        if (e?.status === 401) router.push('/login');
        else setError(e?.message || 'No se pudieron cargar tus equipos');
      });
  }, [router]);

  function salir() {
    clearSession();
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white px-5 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link href="/affiliate" className="flex items-center gap-2">
            <Logo size={28} />
            <span className="hidden text-sm font-semibold sm:inline">← Panel afiliado</span>
          </Link>
          <button type="button" onClick={salir} className="text-xs text-mute hover:text-ink">
            Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6">
        <h1 className="mb-1 text-2xl font-bold">Equipos de ventas</h1>
        <p className="mb-5 mt-0 text-sm text-mute">
          Los equipos en los que trabajas. Entra para ver la agenda, el banco, los chats y el CRM del equipo.
        </p>

        {error ? (
          <div className="card card-pad text-sm text-mute">{error}</div>
        ) : equipos === null ? (
          <div className="h-24 animate-shimmer rounded bg-bg2" />
        ) : equipos.length === 0 ? (
          <div className="card card-pad py-10 text-center text-sm text-mute">
            Todavía no estás en ningún equipo de ventas. Te agrega el líder del equipo o un admin de la marca, desde
            «Colaboradores».
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {equipos.map((e) => (
              <li key={e.id}>
                <Link href={`/affiliate/equipos/${e.id}`} className="card card-pad flex items-center gap-3 hover:bg-bg2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: e.color || '#94a3b8' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{e.nombre}</span>
                    <span className="block text-xs text-mute">
                      {e.roles.length ? e.roles.map((r) => ROL[r] ?? r).join(' + ') : 'Solo lectura'}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm text-mute">Entrar →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
