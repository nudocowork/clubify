// 2026-06-06 — Display unificado del plan Elite + periodicidad + precio total.
//
// Antes cada panel mostraba `${plan.name} · USD ${priceMonthly}/mes` lo
// que generaba confusión: todos los planes aparecían como Elite y todos
// con el mismo precio mensual aunque hubieran pagado Trimestral/Anual.
// Este helper centraliza el formato para que admin + owner + reportes
// hablen el mismo idioma.

export type PlanPeriodicity = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';

// Precios totales por ciclo (USD). Sincronizado con LANDING_PLAN_DEFAULTS
// de `lib/landing-plans.ts`. Si el founder cambia precios desde
// /admin/branding, la landing los toma del backend; este map es el
// fallback usado cuando solo conocemos la periodicidad (porque
// priceMonthly del Plan no refleja Trimestral/Semestral/Anual).
const PERIOD_PRICE_USD: Record<PlanPeriodicity, number> = {
  MENSUAL: 68,
  TRIMESTRAL: 150,
  SEMESTRAL: 278,
  ANUAL: 500,
};

const PERIOD_LABEL: Record<PlanPeriodicity, string> = {
  MENSUAL: 'Mensual',
  TRIMESTRAL: 'Trimestral',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
};

const PERIOD_MONTHS: Record<PlanPeriodicity, number> = {
  MENSUAL: 1,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12,
};

export function periodLabel(p: PlanPeriodicity | null | undefined): string {
  if (!p) return 'Mensual';
  return PERIOD_LABEL[p] ?? 'Mensual';
}

/**
 * Precio total de un ciclo según periodicidad.
 * Si conocemos priceMonthly podemos usarlo como base (priceMonthly * months);
 * si no, caemos al precio canónico del LANDING_PLAN_DEFAULTS.
 */
export function periodTotalUsd(
  p: PlanPeriodicity | null | undefined,
  priceMonthly?: number | null,
): number {
  const period = p ?? 'MENSUAL';
  const fallback = PERIOD_PRICE_USD[period];
  if (priceMonthly && priceMonthly > 0) {
    // Si la base mensual del Plan es razonable, multiplicamos por meses.
    return priceMonthly * PERIOD_MONTHS[period];
  }
  return fallback;
}

/**
 * Etiqueta corta del plan tipo "Elite · Trimestral".
 */
export function formatPlanLabel(
  planName: string | null | undefined,
  periodicity: PlanPeriodicity | null | undefined,
): string {
  const name = planName?.trim() || 'Elite';
  return `${name} · ${periodLabel(periodicity)}`;
}

/**
 * Etiqueta con precio total tipo "Elite · Trimestral · 150 USD".
 */
export function formatPlanLabelWithPrice(
  planName: string | null | undefined,
  periodicity: PlanPeriodicity | null | undefined,
  priceMonthly?: number | null,
): string {
  const label = formatPlanLabel(planName, periodicity);
  const total = periodTotalUsd(periodicity, priceMonthly);
  return `${label} · ${total} USD`;
}

/**
 * Sufijo de cadencia para mostrar al lado del precio total.
 * MENSUAL → "/mes", TRIMESTRAL → "/trimestre", etc.
 */
export function periodCadence(p: PlanPeriodicity | null | undefined): string {
  const period = p ?? 'MENSUAL';
  switch (period) {
    case 'MENSUAL':
      return '/mes';
    case 'TRIMESTRAL':
      return '/trimestre';
    case 'SEMESTRAL':
      return '/semestre';
    case 'ANUAL':
      return '/año';
  }
}
