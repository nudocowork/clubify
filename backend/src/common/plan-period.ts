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
