/**
 * Secciones que el dueño puede marcar para un miembro «Personalizado»
 * (`TENANT_CUSTOM`). Espejo de `backend/src/common/permisos-de-equipo.ts`:
 * allí cada clave abre sus rutas de la API; aquí, sus páginas del panel.
 * Una clave nueva va en los dos sitios.
 */
export type PermisoDeEquipo =
  | 'sellos'
  | 'clientes'
  | 'tarjetas'
  | 'notificaciones'
  | 'resenas'
  | 'reservas'
  | 'servicios'
  | 'marketing'
  | 'menu'
  | 'pedidos'
  | 'estadisticas';

export const SECCIONES_DEL_EQUIPO: Array<{
  clave: PermisoDeEquipo;
  nombre: string;
  detalle: string;
  /** Páginas que abre (prefijos). La primera es adonde entra. */
  paginas: string[];
}> = [
  { clave: 'sellos', nombre: 'Escáner y sellos', detalle: 'Escanear tarjetas, dar sellos e historial de sellos', paginas: ['/scan', '/app/historial-sellos'] },
  { clave: 'clientes', nombre: 'Clientes', detalle: 'Ver y editar la base de clientes', paginas: ['/app/customers'] },
  { clave: 'pedidos', nombre: 'Pedidos', detalle: 'Solo los pedidos de su sede asignada', paginas: ['/app/orders'] },
  { clave: 'tarjetas', nombre: 'Tarjetas', detalle: 'Tarjetas de fidelización, alianzas y club', paginas: ['/app/cards', '/app/alianzas', '/app/club'] },
  { clave: 'notificaciones', nombre: 'Notificaciones push', detalle: 'Enviar y programar notificaciones', paginas: ['/app/notifications'] },
  { clave: 'resenas', nombre: 'Reseñas de Google', detalle: 'Reseñas y su QR', paginas: ['/app/reviews', '/app/marketing/qr-reviews'] },
  { clave: 'reservas', nombre: 'Reservas', detalle: 'Agenda, plano de mesas y eventos', paginas: ['/app/reservations'] },
  { clave: 'servicios', nombre: 'Agenda de servicios', detalle: 'Citas de servicios', paginas: ['/app/servicios'] },
  { clave: 'marketing', nombre: 'QR y promociones', detalle: 'Carteles QR del menú, mostrador y descuentos', paginas: ['/app/marketing'] },
  { clave: 'menu', nombre: 'Menú y catálogo', detalle: 'Productos, menú libro, InfoLink y traducciones', paginas: ['/app/menu', '/app/menu-book', '/app/info-links', '/app/translations'] },
  { clave: 'estadisticas', nombre: 'Estadísticas', detalle: 'Analítica de clientes y pedidos', paginas: ['/app/analytics'] },
];

const coincide = (ruta: string, pagina: string) => ruta === pagina || ruta.startsWith(pagina + '/');

/**
 * ¿Puede un miembro con estos permisos estar en esta página? Lo más largo
 * gana: `/app/marketing/qr-reviews` es de Reseñas, no de Marketing.
 */
export function paginaPermitida(ruta: string, permisos: readonly string[]): boolean {
  let mejor: { largo: number; clave: string } | null = null;
  for (const s of SECCIONES_DEL_EQUIPO) {
    for (const p of s.paginas) {
      if (coincide(ruta, p) && (!mejor || p.length > mejor.largo)) mejor = { largo: p.length, clave: s.clave };
    }
  }
  return !!mejor && permisos.includes(mejor.clave);
}

/**
 * Adonde entra: la primera página del PANEL que tiene. El escáner (/scan) va
 * fuera del panel y sin menú: si fuera la entrada, quien tiene Sellos y
 * Clientes volvería siempre al escáner y nunca vería el menú. Solo es la
 * entrada si no tiene ninguna otra sección.
 */
export function primeraPaginaPermitida(permisos: readonly string[]): string | null {
  const paginas = SECCIONES_DEL_EQUIPO.filter((x) => permisos.includes(x.clave)).flatMap((x) => x.paginas);
  return paginas.find((p) => p.startsWith('/app')) ?? paginas[0] ?? null;
}
