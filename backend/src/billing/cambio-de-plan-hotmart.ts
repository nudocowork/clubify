/**
 * ¿Este cobro es un CAMBIO DE PLAN del negocio?
 *
 * Casos El Tiros Club (28-oct) y la burguesía (16-sep y 29-oct): tenían un
 * trimestral de USD 150, dejaron caer esa suscripción y compraron el mensual
 * de USD 50 (oferta `vkfveas1`) con una suscripción NUEVA. El webhook solo
 * escribía la periodicidad cuando el negocio no tenía ninguna («un valor ya
 * cargado no se pisa»), así que los dos siguieron como TRIMESTRAL: la ficha
 * decía «Plan Trimestral · 150 USD», cada cobro de 50 entraba a Contabilidad
 * como 150 y la comisión salía sobre 150. La fecha de cobro sí quedó bien
 * porque esa la manda Hotmart.
 *
 * Es cambio de plan cuando llega una suscripción distinta de la que el negocio
 * tenía, en su primer cobro, y el plan que se pagó se conoce y no es el que
 * figura (otra periodicidad, u otro precio declarado en su enlace de venta).
 * Si no se sabe qué plan es, no se adivina: se deja lo que hay.
 *
 * No aplica a los servicios adicionales: esos se apartan antes, en
 * `tryHandleServicioAdicional`.
 */
export function esCambioDePlanHotmart(args: {
  codigoNuevo: string | null | undefined;
  codigoAnterior: string | null | undefined;
  recurrencia: unknown;
  periodicidadActual: string | null | undefined;
  periodicidadDelPago: string | null | undefined;
  precioActual: number | null | undefined;
  precioDeLaOferta: number | null | undefined;
}): boolean {
  const nuevo = (args.codigoNuevo ?? '').trim();
  const anterior = (args.codigoAnterior ?? '').trim();
  if (!nuevo || !anterior || nuevo === anterior) return false;
  const r = Number(args.recurrencia);
  if (Number.isInteger(r) && r > 1) return false;
  const pago = (args.periodicidadDelPago ?? '').toUpperCase();
  if (!pago) return false;
  if (pago !== (args.periodicidadActual ?? '').toUpperCase()) return true;
  return args.precioDeLaOferta != null && Number(args.precioDeLaOferta) !== Number(args.precioActual ?? NaN);
}
