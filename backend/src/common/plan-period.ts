/**
 * Convención global de pricing/billing: planPeriodicity null o desconocido
 * se trata como MENSUAL. Antes esto vivía duplicado en admin-reports y
 * commission-exceptions services — ver memoria feedback_normalize_period_mensual_convention.
 *
 * Mantener acá: cualquier código que haga lookup en BUNDLE/PERIODS por
 * t.planPeriodicity debería normalizar primero con este helper, sino el
 * tenant queda excluido silencioso del cálculo (MRR/billed/revenue).
 */
const KNOWN_PERIODS = new Set(['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL']);

export function normalizePlanPeriod(p: string | null | undefined): string {
  if (!p) return 'MENSUAL';
  const upper = p.toUpperCase();
  return KNOWN_PERIODS.has(upper) ? upper : 'MENSUAL';
}

/** Meses que dura un ciclo según la periodicidad. MENSUAL=1, TRIMESTRAL=3,
 *  SEMESTRAL=6, ANUAL=12. Null/desconocido → 1 (MENSUAL). */
export function bundleMonths(p: string | null | undefined): number {
  switch (normalizePlanPeriod(p)) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}

/** Suma un ciclo completo (en MESES, no 30 días fijos) a una fecha según la
 *  periodicidad del plan. Es el cálculo correcto del "próximo cobro" cuando
 *  Hotmart no envía date_next_charge. Usa setMonth para respetar meses reales
 *  (un Trimestral = +3 meses, no +90 días). */
export function addPlanPeriod(from: Date, p: string | null | undefined): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + bundleMonths(p));
  return d;
}
