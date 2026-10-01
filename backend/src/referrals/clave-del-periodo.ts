import { monthKey } from '../common/period-key';

/**
 * DOS COBROS EN EL MISMO MES (Wok Explosivo, 2026-10-01)
 *
 * Un plan mensual cobra una vez al mes… salvo cuando un cobro se RETRASA. A Wok
 * le tocaba el 26-ago, Hotmart lo reintentó y entró el 1-sep; el siguiente
 * entró el 28-sep, a su día. Dos cobros reales en septiembre, y el del 28 se
 * quedó SIN comisión por dos candados que daban el mes por «ya cobrado»:
 *
 *  1. El webhook saltaba el cobro si ya había una comisión con fecha en el
 *     MISMO MES CALENDARIO (`sameCycle`).
 *  2. La clave única `(referralUseId, recipientCodeId, periodKey)` usa el mes
 *     como `periodKey`: aunque alguien intentara crearla —el reconciliador de
 *     cada noche lo intenta—, chocaba y se descartaba con un warn.
 *
 * El «mismo cobro» no es el mismo mes: es la misma FECHA, con algo de margen
 * para la reconciliación (que escribe `lastChargeAt`, la fecha del cobro, unas
 * horas después). Dos cobros distintos de un mismo afiliado nunca están a menos
 * de unos días — ni el más retrasado cae encima del siguiente.
 */

/** Dos comisiones a esta distancia o menos son del MISMO cobro. */
export const MARGEN_MISMO_COBRO_MS = 3 * 86_400_000;

export function esElMismoCobro(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= MARGEN_MISMO_COBRO_MS;
}

/**
 * La `periodKey` de la comisión de un cobro: el mes (`2026-09`), como siempre,
 * salvo que ese mes ya esté ocupado por la comisión de OTRO cobro del mismo
 * referido. Entonces el día (`2026-09-28`), que es única por cobro y sigue
 * empezando por el mes para quien agrupe por los 7 primeros caracteres.
 *
 * `ocupadas`: las comisiones del referido cuya clave es ese mes.
 */
export function claveDelPeriodo(
  fechaDelCobro: Date,
  ocupadas: Array<{ businessDate: Date | null; createdAt: Date }>,
): string {
  const mes = monthKey(fechaDelCobro);
  const deOtroCobro = ocupadas.some(
    (c) => !esElMismoCobro(c.businessDate ?? c.createdAt, fechaDelCobro),
  );
  return deOtroCobro ? fechaDelCobro.toISOString().slice(0, 10) : mes;
}
