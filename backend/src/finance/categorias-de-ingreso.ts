/**
 * Las categorías y los estados de un ingreso.
 *
 * Viven en un solo sitio y como TEXTO (no como enum de Postgres) porque lo que
 * se pidió fue poder añadir una categoría nueva sin rehacer el módulo: añadir
 * una línea aquí y ya cuenta en el panel, sin migración ni despliegue de base.
 */

export const CATEGORIAS_DE_INGRESO = {
  NUEVA: 'Suscripción nueva',
  RENOVACION: 'Renovación',
  UPGRADE: 'Upgrade',
  OTRO: 'Otro ingreso',
} as const;

export type CategoriaDeIngreso = keyof typeof CATEGORIAS_DE_INGRESO;

export const ESTADOS_DE_INGRESO = {
  PAGADO: 'Pagado',
  REEMBOLSADO: 'Reembolsado',
  CANCELADO: 'Cancelado',
} as const;

export type EstadoDeIngreso = keyof typeof ESTADOS_DE_INGRESO;

/** Solo el dinero PAGADO suma. Un reembolso no se borra: deja de contar. */
export const SOLO_LO_COBRADO = { status: 'PAGADO' } as const;

/**
 * Qué clase de ingreso es un cobro.
 *
 * - Sin negocio y con nombre de producto → un pack de créditos o un servicio
 *   suelto: OTRO. No es una suscripción, no lleva plan ni comisión.
 * - Primer pago del negocio → NUEVA.
 * - El resto → RENOVACION.
 *
 * UPGRADE se pasa explícito desde el camino que lo sabe (un cambio de plan con
 * cobro de por medio); NO se adivina, porque adivinarlo mal convierte una
 * renovación en venta nueva y descuadra "cuánto vino de ventas nuevas".
 */
export function categoriaDeIngreso(args: {
  tenantId?: string | null;
  productName?: string | null;
  isFirstPayment?: boolean;
  categoria?: CategoriaDeIngreso | null;
}): CategoriaDeIngreso {
  if (args.categoria) return args.categoria;
  if (!args.tenantId && args.productName) return 'OTRO';
  return args.isFirstPayment ? 'NUEVA' : 'RENOVACION';
}
