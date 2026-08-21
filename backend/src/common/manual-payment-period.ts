import { addPlanPeriod, normalizePlanPeriod } from './plan-period';

/**
 * Ciclo que cubre un pago manual (Nequi / efectivo / transferencia).
 *
 * **El ciclo arranca en la FECHA DE PAGO.** Si el negocio pagó su plan
 * trimestral el 4 de julio, queda cubierto hasta el 4 de octubre. Punto.
 *
 * FIX 2026-08-21 — antes esto encadenaba desde `currentPeriodEnd` y calculaba
 * desde `now`, así que **la fecha que escribía el usuario no se usaba para
 * nada**: se guardaba en el historial y el ciclo salía de otro lado. Caso real:
 * pago del 4-jul de un trimestral, y el sistema devolvió 21-nov → 21-feb.
 *
 * La regla vieja intentaba ser lista («no le quites días ya pagados si paga por
 * adelantado»), pero adivinaba: producía fechas que no se pueden explicar
 * mirando el formulario. Una regla predecible que a veces hay que ajustar a
 * mano vale más que una lista que sorprende. Si el pago acorta la cobertura
 * vigente, el aviso se lo damos al usuario ANTES de confirmar (`acorta`), en
 * vez de decidir por él.
 */
export function resolveManualPaymentPeriod(
  /** Fecha en que el cliente pagó de verdad. Es la que manda. */
  paidAt: Date,
  /** Cobertura vigente antes de este pago. Solo se usa para avisar. */
  currentPeriodEnd: Date | null | undefined,
  planPeriodicity: string | null | undefined,
): {
  periodStart: Date;
  periodEnd: Date;
  periodicity: string;
  /**
   * true si el nuevo ciclo termina ANTES de la cobertura que ya tenía. No
   * bloquea nada — es para que el panel lo advierta y el humano decida.
   */
  acorta: boolean;
} {
  const periodStart = new Date(paidAt);
  const periodEnd = addPlanPeriod(periodStart, planPeriodicity);
  return {
    periodStart,
    periodEnd,
    periodicity: normalizePlanPeriod(planPeriodicity),
    acorta: !!currentPeriodEnd && periodEnd.getTime() < currentPeriodEnd.getTime(),
  };
}
