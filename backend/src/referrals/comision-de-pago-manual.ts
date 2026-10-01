/**
 * ¿Esta comisión nació de un PAGO MANUAL (Nequi, efectivo, transferencia)?
 *
 * Pedido de Javier (2026-10-01): en la lista de comisiones, una etiqueta
 * «Pago manual» como la de «Renovación», para saber de un vistazo qué ventas
 * no pasaron por una pasarela.
 *
 * Un pago manual no crea comisiones por sí mismo: mueve el `lastChargeAt` del
 * negocio a la fecha del pago, y la comisión la crea después el reconciliador
 * de renovaciones SIN transacción de Hotmart. Así que la única forma de
 * reconocerla es por la fecha: sin transacción y a pocos días de un
 * `ManualPayment` del mismo negocio. Una con transacción vino de la pasarela,
 * aunque el negocio también tenga pagos manuales en otras fechas.
 */

/** Margen entre la fecha de la comisión y la del pago (zonas horarias, captura). */
export const MARGEN_DIAS_PAGO_MANUAL = 3;

export function esComisionDePagoManual(
  fechaDeLaComision: Date,
  transaccion: string | null | undefined,
  pagosManualesDelNegocio: Date[],
): boolean {
  if (transaccion) return false;
  const margen = MARGEN_DIAS_PAGO_MANUAL * 86_400_000;
  const t = fechaDeLaComision.getTime();
  return pagosManualesDelNegocio.some((p) => Math.abs(p.getTime() - t) <= margen);
}
