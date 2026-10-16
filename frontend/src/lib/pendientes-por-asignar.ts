/**
 * El contador de «Pendientes por asignar vendedor» vive en el menú (AppShell)
 * y las acciones en la página de Comisiones y en la ficha del negocio. Este
 * evento le avisa al menú que vuelva a contar, sin esperar a recargar la página
 * — si el número no baja al asignar, nadie se fía de él.
 */
export const EVENTO_PENDIENTES_POR_ASIGNAR = 'clubify:pendientes-por-asignar';

export function avisarCambioPendientesPorAsignar() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENTO_PENDIENTES_POR_ASIGNAR));
}
