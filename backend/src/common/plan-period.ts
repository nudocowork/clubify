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

/** Extrae la periodicidad de una etiqueta libre (ej. el `subscription.plan.name`
 *  de Hotmart: "Plan Trimestral 150 USD"). Devuelve null si no reconoce ninguna
 *  — a diferencia de normalizePlanPeriod, que asume MENSUAL. Esa diferencia es
 *  deliberada: acá "no sé" NO debe convertirse en "mensual", sino en "no tocar".
 *
 *  BUG 2026-08-18 (El Arrayán express): la periodicidad venía SOLO del form de
 *  /activar. Si el comprador no pasaba por el pre-llenado quedaba null → todo el
 *  sistema lo leía como MENSUAL: próximo cobro a +1 mes sobre un plan trimestral
 *  (y suspensión automática 3 días después de esa fecha falsa, con el cliente al
 *  día) y comisión sobre el canónico mensual ($68) en vez del trimestral ($150). */
export function parsePlanPeriodLabel(
  label: string | null | undefined,
): 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL' | null {
  const upper = String(label ?? '').toUpperCase();
  if (!upper) return null;
  // El orden importa: va de lo MÁS específico a lo más general, porque las
  // etiquetas se contienen entre sí. "SEMIANUAL" contiene "ANUAL", así que si
  // ANUAL se chequeara primero, un plan semianual saldría clasificado como
  // anual. Mismo criterio para TRIMESTRAL antes que cualquier comodín.
  if (/SEMESTRAL|SEMIANUAL|BIANNUAL|SEMIANNUAL/.test(upper)) return 'SEMESTRAL';
  if (/TRIMESTRAL|QUARTERLY/.test(upper)) return 'TRIMESTRAL';
  if (/ANUAL|ANUALIDAD|ANNUAL|YEARLY/.test(upper)) return 'ANUAL';
  if (/MENSUAL|MONTHLY/.test(upper)) return 'MENSUAL';
  return null;
}

/** Suma un ciclo completo (en MESES, no 30 días fijos) a una fecha según la
 *  periodicidad del plan. Es el cálculo correcto del "próximo cobro" cuando
 *  la pasarela no envía la fecha, y el que usa el pago manual.
 *
 *  FIX 2026-08-20 — fin de mes. `setMonth` a secas NO acota el día: si el día
 *  no existe en el mes destino, JavaScript desborda al siguiente. Medido:
 *
 *    31-ene + 1 mes  →  3-mar   (febrero desaparecía)
 *    31-mar + 1 mes  →  1-may
 *    31-ago + 6 meses → 3-mar
 *
 *  El error se propagaba ciclo a ciclo en el auto-reparador, y hacía que los
 *  recordatorios D-7/D-1 apuntaran a una fecha que no era la del cobro real.
 *  Ahora el día se acota al último del mes destino: 31-ene + 1 mes = 28-feb. */
export function addPlanPeriod(from: Date, p: string | null | undefined): Date {
  const d = new Date(from);
  const dia = d.getDate();
  // Ir al día 1 antes de mover el mes: así `setMonth` no puede desbordar.
  d.setDate(1);
  d.setMonth(d.getMonth() + bundleMonths(p));
  // Último día del mes destino: el día 0 del mes siguiente.
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDia));
  return d;
}
