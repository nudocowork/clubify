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

export function periodLabel(p: PlanPeriodicity | null | undefined): string {
  if (!p) return 'Mensual';
  return PERIOD_LABEL[p] ?? 'Mensual';
}

/**
 * Precio total de un ciclo según periodicidad.
 * Default: precio canónico del bundle (lo que cobra Hotmart).
 * Si la periodicidad es MENSUAL y conocemos priceMonthly, lo usamos para
 * respetar overrides del Plan row. Para TRIMESTRAL/SEMESTRAL/ANUAL NUNCA
 * multiplicamos priceMonthly: el bundle tiene su propio descuento y
 * priceMonthly suele ser 68 (Elite mensual), que multiplicado infla los
 * totales (204/408/816) y no coincide con lo que el cliente pagó.
 */
export function periodTotalUsd(
  p: PlanPeriodicity | null | undefined,
  priceMonthly?: number | null,
): number {
  const period = p ?? 'MENSUAL';
  if (period === 'MENSUAL' && priceMonthly && priceMonthly > 0) {
    return priceMonthly;
  }
  return PERIOD_PRICE_USD[period];
}

/**
 * Nombre a MOSTRAR del plan. PDF Software(10) — UNIFICACIÓN DE PLANES:
 * el plan se muestra SIEMPRE por su periodicidad (Plan Mensual / Trimestral /
 * Semestral / Anual), sin importar el nombre interno del Plan row ("Elite",
 * "Sin plan", "Pro"). "Elite" queda solo como SKU interno (gating/Hotmart),
 * nunca visible para el usuario. Los registros SIN periodicidad conocida
 * (legacy o trials sin plan definido) se muestran como "Sin definir" para que
 * el admin los revise y asigne. Antes esto devolvía el nombre crudo ("Elite")
 * cuando existía → generaba la mezcla "Elite" vs "Plan Trimestral".
 */
export function planDisplayName(
  planName: string | null | undefined,
  periodicity: PlanPeriodicity | null | undefined,
): string {
  // planName (Elite / Sin plan / Pro) ya no se muestra: el plan ES la
  // periodicidad. La PERIODICIDAD MANDA — si el negocio se creó con una
  // periodicidad, se muestra "Plan {Periodicidad}" aunque su Plan row sea
  // "Sin plan" (PDF Soft 10 fix 2026-08-13: antes "Sin plan" tapaba la
  // periodicidad). Solo sin periodicidad conocida → "Sin definir".
  void planName;
  if (periodicity) return `Plan ${periodLabel(periodicity)}`;
  return 'Sin definir';
}

/**
 * Etiqueta corta del plan. Unificada: "Plan Trimestral" (antes "Elite ·
 * Trimestral"). PDF Software(10).
 */
export function formatPlanLabel(
  planName: string | null | undefined,
  periodicity: PlanPeriodicity | null | undefined,
): string {
  return planDisplayName(planName, periodicity);
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
