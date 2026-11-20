/**
 * ROL «PERSONALIZADO» (`TENANT_CUSTOM`) DEL EQUIPO DE UN NEGOCIO.
 *
 * Javier (2026-11-20): el dueño marca qué secciones ve cada miembro del equipo
 * y el miembro ve SOLO eso. Si se marcan Sellos y Clientes, solo eso; si se
 * marca Pedidos, solo los pedidos de SU sede.
 *
 * Una casilla abre las rutas del backend de su sección (`RUTAS`). Todo lo que
 * no está aquí —Suscripción, Equipo, Configuración, Sedes, Referidos— queda
 * cerrado para este rol, marque lo que marque el dueño: es la administración
 * del negocio, no trabajo del día.
 *
 * El frontend tiene su espejo en `frontend/src/lib/permisos-de-equipo.ts`
 * (mismas claves, con las páginas del panel de cada una). Si añades una clave
 * aquí, añádela allí.
 */

export const PERMISOS_DE_EQUIPO = [
  'sellos',
  'clientes',
  'tarjetas',
  'notificaciones',
  'resenas',
  'reservas',
  'servicios',
  'marketing',
  'menu',
  'pedidos',
  'estadisticas',
] as const;

export type PermisoDeEquipo = (typeof PERMISOS_DE_EQUIPO)[number];

/**
 * Qué secciones abren cada ruta del backend (prefijo, sin `/api`). Una ruta
 * puede servir a varias: el catálogo de productos lo necesitan el Menú y
 * también Pedidos (para armar un pedido manual), igual que hace hoy «Solo
 * pedidos».
 */
const RUTAS: Array<[prefijo: string, permisos: PermisoDeEquipo[]]> = [
  ['scanner', ['sellos']],
  ['stamps', ['sellos', 'clientes']],
  ['passes', ['sellos', 'clientes', 'tarjetas']],
  ['badges', ['sellos', 'tarjetas']],
  ['customers', ['clientes', 'pedidos']],
  ['messages', ['clientes']],
  ['cards', ['tarjetas']],
  ['club', ['tarjetas']],
  ['convenios', ['tarjetas']],
  ['tenants/me/formulario-registro', ['tarjetas']],
  ['notifications', ['notificaciones']],
  ['automations', ['notificaciones']],
  ['reviews', ['resenas']],
  ['review-locations', ['resenas']],
  ['review-qr-targets', ['resenas']],
  ['reservations', ['reservas']],
  ['reservation-events', ['reservas']],
  ['service-reservations', ['servicios']],
  // El cartel QR de reseñas vive en Marketing pero es de la sección Reseñas.
  ['qr-posters', ['marketing', 'resenas']],
  ['promotions', ['marketing']],
  ['catalog/products', ['menu', 'pedidos']],
  ['catalog', ['menu']],
  ['info-links', ['menu']],
  ['orders', ['pedidos']],
  ['delivery-business', ['pedidos']],
  ['metrics', ['estadisticas']],
  // Subir imágenes: lo usan el menú, los QR y las tarjetas.
  ['media', ['menu', 'marketing', 'tarjetas']],
];

/** Solo las claves conocidas, sin repetir. Lo que venga de fuera pasa por aquí. */
export function limpiarPermisos(entrada: unknown): PermisoDeEquipo[] {
  if (!Array.isArray(entrada)) return [];
  const validos = new Set<string>(PERMISOS_DE_EQUIPO);
  return [...new Set(entrada.filter((x): x is PermisoDeEquipo => typeof x === 'string' && validos.has(x)))];
}

/**
 * Las secciones que abren esta ruta, o null si la ruta no es de ninguna
 * sección (entonces decide el `@Roles` de siempre). Gana el prefijo más largo:
 * `catalog/products` antes que `catalog`.
 */
export function seccionesDeLaRuta(ruta: string): PermisoDeEquipo[] | null {
  const r = ruta.replace(/^\/+/, '').replace(/^api\//, '');
  let mejor: [string, PermisoDeEquipo[]] | null = null;
  for (const [prefijo, permisos] of RUTAS) {
    if (r === prefijo || r.startsWith(prefijo + '/')) {
      if (!mejor || prefijo.length > mejor[0].length) mejor = [prefijo, permisos];
    }
  }
  return mejor ? mejor[1] : null;
}

/** Roles del negocio en cuyo lugar puede entrar el personalizado. */
const ROLES_DEL_NEGOCIO = ['TENANT_OWNER', 'TENANT_STAFF', 'TENANT_CUSTOM'];

/**
 * ¿Puede un miembro personalizado con estos permisos usar esta ruta?
 *
 * - Ruta de una sección: solo si tiene esa sección marcada, y si la ruta es
 *   del negocio (sin `@Roles` o con un rol del negocio). Una ruta solo de
 *   admin de plataforma nunca se abre.
 * - Ruta que no es de ninguna sección: lo mismo que «Solo pedidos», abierta
 *   solo si no exige rol o si nombra a `TENANT_CUSTOM` a propósito (sus datos,
 *   los del negocio para pintar el panel).
 */
export function personalizadoPuede(
  ruta: string,
  rolesExigidos: string[] | null | undefined,
  permisos: readonly string[],
): boolean {
  const exigidos = rolesExigidos ?? [];
  const secciones = seccionesDeLaRuta(ruta);
  if (secciones) {
    if (!secciones.some((s) => permisos.includes(s))) return false;
    return exigidos.length === 0 || exigidos.some((r) => ROLES_DEL_NEGOCIO.includes(r));
  }
  return exigidos.length === 0 || exigidos.includes('TENANT_CUSTOM');
}
