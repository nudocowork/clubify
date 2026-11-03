/**
 * Los planes con ABONO de Hotmart.
 *
 * CÓMO SE VENDEN (Javier, 2026-11-03)
 * -----------------------------------
 * El cliente aparta con un abono de USD 20 (producto «CLUBIFY - SERVICIOS
 * ADICIONALES», oferta `9veek0a9`). Cuando decide entrar, paga el restante con
 * una oferta «+ Abono» del producto de suscripción:
 *
 *   Plan abono mensual     48  (+20 = 68)
 *   Plan abono trimestral  130 (+20 = 150)
 *   Plan abono semestral   258 (+20 = 278)
 *   Plan abono anual       480 (+20 = 500)
 *
 * Solo el PRIMER cobro lleva el descuento: las recurrencias de esa misma
 * suscripción entran al precio completo del plan.
 *
 * POR QUÉ HACE FALTA
 * ------------------
 * El restante se contabilizaba al precio completo del plan (68/150/500), y los
 * 20 del abono ya estaban contados aparte: cada venta con abono sumaba 20 USD
 * que nunca entraron (Las Ricuras: 20 + 150 = 170 por un trimestral de 150).
 * Inflaba el total del mes y, con él, la parte del socio y el 2 % del PM.
 *
 * Lo que NO cambia: la comisión del closer sigue saliendo sobre el plan
 * completo y solo cuando entra el restante. El abono solo no da comisión al
 * closer (ese producto nunca la genera).
 *
 * Los códigos están aquí y no en el ajuste de enlaces de venta porque en el
 * enlace `precioUsd` significa otra cosa (lo que se cobra en el checkout) y su
 * `precioEsElDelPlan` gobierna la base de la comisión: mezclarlos bajaba la
 * comisión del closer a 48.
 */

export type PeriodicidadConAbono = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

export interface OfertaConAbono {
  nombre: string;
  periodicidad: PeriodicidadConAbono;
  /** Lo que se cobra en el primer pago: el plan menos el abono. */
  primerPagoUsd: number;
  /** El precio del plan: el de las recurrencias y la base de la comisión. */
  precioDelPlanUsd: number;
}

export const ABONO_USD = 20;

/** Oferta del abono de 20 en el producto de servicios adicionales. */
export const OFERTAS_DE_ABONO = ['9veek0a9'];

export const OFERTAS_CON_ABONO: Readonly<Record<string, OfertaConAbono>> = {
  n8e031ty: { nombre: 'Plan abono mensual', periodicidad: 'MENSUAL', primerPagoUsd: 48, precioDelPlanUsd: 68 },
  iqbgp4fq: { nombre: 'Plan abono trimestral', periodicidad: 'TRIMESTRAL', primerPagoUsd: 130, precioDelPlanUsd: 150 },
  '52fe5ax7': { nombre: 'Plan abono semestral', periodicidad: 'SEMESTRAL', primerPagoUsd: 258, precioDelPlanUsd: 278 },
  kkczwdkt: { nombre: 'Plan abono anual', periodicidad: 'ANUAL', primerPagoUsd: 480, precioDelPlanUsd: 500 },
};

const limpio = (codigo: string | null | undefined) => (codigo ?? '').trim().toLowerCase();

export function ofertaConAbono(codigo: string | null | undefined): OfertaConAbono | null {
  return OFERTAS_CON_ABONO[limpio(codigo)] ?? null;
}

export function esOfertaDeAbono(codigo: string | null | undefined): boolean {
  const c = limpio(codigo);
  return !!c && OFERTAS_DE_ABONO.includes(c);
}

/**
 * Lo que se contabiliza por un cobro de una oferta con abono: el restante en el
 * primer pago, null en el resto (las recurrencias van al precio del plan por el
 * camino normal). Sin número de recurrencia se toma como primer pago: Hotmart
 * lo omite en compras sueltas, y una recurrencia siempre lo trae.
 */
export function ingresoDelPagoConAbono(
  codigo: string | null | undefined,
  recurrencia: unknown,
): number | null {
  const oferta = ofertaConAbono(codigo);
  if (!oferta) return null;
  const n = Number(recurrencia);
  const esPrimerPago = recurrencia == null || recurrencia === '' || !Number.isFinite(n) || n <= 1;
  return esPrimerPago ? oferta.primerPagoUsd : null;
}
