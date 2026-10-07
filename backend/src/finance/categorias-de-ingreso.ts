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
  /** Lo que una marca blanca le paga a la plataforma (rebranding, servicios). */
  MARCA_BLANCA: 'Marca blanca',
} as const;

export type CategoriaDeIngreso = keyof typeof CATEGORIAS_DE_INGRESO;

export const ESTADOS_DE_INGRESO = {
  PAGADO: 'Pagado',
  REEMBOLSADO: 'Reembolsado',
  CANCELADO: 'Cancelado',
  /** Cobro real, apartado mientras se decide qué es (no suma en ningún total).
   *  Sara, 2026-10-03: los «Servicios adicionales» de ~$20. */
  EN_REVISION: 'En revisión',
  /** Dinero que pasó por Clubify pero es de otro: Clubify solo hace de
   *  intermediario (la automatización de WhatsApp que una marca blanca paga
   *  para entregársela a un tercero). Se guarda el registro pero NO es ingreso
   *  de Clubify: no suma en ningún total, ni del socio ni del 2 %. Sara,
   *  2026-10-06: «deben sumar como servicios adicionales (automatizaciones)». */
  INTERMEDIADO: 'Servicio adicional (intermediado)',
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
