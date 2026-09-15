'use client';

import { usePathname } from 'next/navigation';

/**
 * Dónde viven las pantallas de un equipo de ventas.
 *
 * Las mismas pantallas se montan en dos sitios: el panel de admin
 * (`/admin/sales-teams/<id>`) y el panel del afiliado (`/affiliate/equipos/<id>`),
 * porque los colaboradores de un equipo son afiliados y no entran al de admin
 * (decisión de Javier, 2026-09-14). Cada enlace interno —pestañas, «Abrir ficha»,
 * «Volver»— tiene que quedarse en el panel desde el que se abrió: con la ruta de
 * admin escrita a mano, un afiliado que pulsaba «Abrir ficha» caía en /admin y
 * lo echaban a /app.
 *
 * Con `usePathname` y no con `window.location`: la ruta existe también al pintar
 * en el servidor, así que el enlace no cambia al hidratar.
 */
export const BASE_ADMIN = '/admin/sales-teams';
export const BASE_AFILIADO = '/affiliate/equipos';

export function useBaseDeEquipos(): string {
  const ruta = usePathname() ?? '';
  return ruta.startsWith(BASE_AFILIADO) ? BASE_AFILIADO : BASE_ADMIN;
}
