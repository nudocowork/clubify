import { addPlanPeriod, normalizePlanPeriod } from './plan-period';

/**
 * Ciclo que cubre un pago manual (Nequi / efectivo / transferencia).
 *
 * La fecha de arranque decide cuánto tiempo real recibe el cliente, así que
 * la regla es "ni regalar ni quitar":
 *
 *  - Ciclo vigente (currentPeriodEnd en el futuro) → el pago compra el ciclo
 *    SIGUIENTE: encadena desde currentPeriodEnd. Arrancar desde hoy le
 *    quitaría al cliente los días que ya tiene pagados de este ciclo.
 *  - Ciclo vencido (o negocio sin ciclo aún) → el ciclo nuevo arranca HOY.
 *    Encadenar desde la fecha vencida entregaría un ciclo ya parcialmente
 *    consumido (le quita tiempo por el que acaba de pagar); y arrancar en una
 *    fecha futura le regalaría días sin pagar. Los días entre el vencimiento
 *    y hoy quedaron cubiertos de facto por el gate de no-suspensión de
 *    `manualPayment` — no se cobran ni se descuentan.
 *
 * El largo del ciclo lo dicta SIEMPRE la periodicidad del plan vía
 * `addPlanPeriod` (1/3/6/12 meses reales, nunca 30 días fijos).
 */
export function resolveManualPaymentPeriod(
  now: Date,
  currentPeriodEnd: Date | null | undefined,
  planPeriodicity: string | null | undefined,
): {
  periodStart: Date;
  periodEnd: Date;
  periodicity: string;
  /** true si encadenó desde un ciclo vigente (pago por adelantado). */
  chained: boolean;
} {
  const chained =
    !!currentPeriodEnd && currentPeriodEnd.getTime() > now.getTime();
  const periodStart = chained ? new Date(currentPeriodEnd!) : new Date(now);
  return {
    periodStart,
    periodEnd: addPlanPeriod(periodStart, planPeriodicity),
    periodicity: normalizePlanPeriod(planPeriodicity),
    chained,
  };
}
