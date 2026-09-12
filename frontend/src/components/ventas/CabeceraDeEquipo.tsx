'use client';

/**
 * La cabecera con pestañas de un equipo de ventas.
 *
 * Antes cada pantalla del equipo era una isla: se llegaba desde la lista y
 * para pasar del tablero a la agenda había que volver atrás. Esto las junta,
 * como la referencia de TeamClubify.
 *
 * SOLO SE PINTAN LAS PESTAÑAS QUE EXISTEN. Ofrecer una que no lleva a ningún
 * sitio es el mismo fallo que acabamos de arreglar en el menú de Sellea: el
 * panel prometía «Equipos de ventas» y te devolvía al escritorio. Cuando haya
 * pantalla para Banco, Conversaciones o Colaboradores, se añaden aquí.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type EquipoDeCabecera = {
  id: string;
  name: string;
  color?: string | null;
  isActive?: boolean;
  leadUser?: { fullName: string } | null;
};

const PESTANAS = [
  { sufijo: '', etiqueta: 'Resumen' },
  { sufijo: '/board', etiqueta: 'Tablero' },
  { sufijo: '/agenda', etiqueta: 'Agenda' },
] as const;

export function CabeceraDeEquipo({
  equipo,
  soloLectura,
}: {
  equipo: EquipoDeCabecera;
  soloLectura?: boolean;
}) {
  const pathname = usePathname();
  const base = `/admin/sales-teams/${equipo.id}`;
  // El pathname puede venir con el prefijo de marca (/admin/<slug>/...): lo que
  // decide la pestaña activa es lo que hay DESPUÉS del id del equipo.
  const i = pathname.indexOf(base);
  const resto = i >= 0 ? pathname.slice(i + base.length) : '';

  return (
    <div className="mb-4">
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap text-white"
        style={{ background: equipo.color || '#1baf7a' }}
      >
        <span className="font-bold text-base">{equipo.name}</span>
        {equipo.leadUser && (
          <span className="text-white/80 text-sm">· {equipo.leadUser.fullName}</span>
        )}
        {equipo.isActive === false && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/25">
            Pausado
          </span>
        )}
        {soloLectura && (
          <span className="text-[11px] text-white/80">Tu rol aquí es de solo lectura</span>
        )}
        <Link
          href="/admin/sales-teams"
          className="ml-auto text-sm font-semibold bg-white/20 hover:bg-white/30 transition rounded-pill px-3 py-1.5 whitespace-nowrap"
        >
          ← Todos los equipos
        </Link>
      </div>

      <div className="flex items-center gap-1 mt-1 border-b border-line2 overflow-x-auto">
        {PESTANAS.map((p) => {
          const activa = resto === p.sufijo || (p.sufijo && resto.startsWith(p.sufijo));
          return (
            <Link
              key={p.sufijo || 'resumen'}
              href={`${base}${p.sufijo}`}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
                activa
                  ? 'border-brand text-brand'
                  : 'border-transparent text-mute hover:text-ink'
              }`}
            >
              {p.etiqueta}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
