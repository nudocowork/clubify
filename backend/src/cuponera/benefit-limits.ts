/**
 * Ventana de conteo del tope por miembro de un beneficio (spec §7).
 *
 * Los períodos son de CALENDARIO en America/Bogota (UTC-5, sin DST), no
 * ventanas móviles: el spec dice "2 veces al mes" y la pantalla del canje
 * muestra "usos restantes ESTE MES". Un usuario que canjeó el 31 vuelve a
 * tener sus usos el 1°, que es lo que espera.
 *
 * OJO — criterio OPUESTO al de los sellos comunitarios: `grantStamp` usa
 * `maxPerDay` sobre las ÚLTIMAS 24 HORAS (ventana móvil, anti-abuso). Son dos
 * reglas distintas a propósito; no unificarlas sin decidirlo.
 *
 * Helpers PUROS (sin DB, sin Date.now() implícito) para poder testearlos.
 */

/** Espejo del enum BenefitLimitPeriod de Prisma. */
export type BenefitLimitPeriod = 'LIFETIME' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** Bogotá = UTC-5 todo el año. 5 horas en milisegundos. */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Inicio de la ventana vigente para `period`, como instante UTC.
 * `null` = LIFETIME: sin ventana, se cuenta todo el historial (comportamiento
 * previo a esta feature, que es el default de la columna).
 *
 * La semana arranca el LUNES (criterio ISO, el que usa la operación).
 */
export function benefitPeriodStart(
  period: BenefitLimitPeriod | null | undefined,
  now: Date,
): Date | null {
  if (!period || period === 'LIFETIME') return null;

  // Se corre el reloj a "hora de pared" de Bogotá para poder truncar con los
  // getters UTC, y al final se devuelve el instante UTC equivalente.
  const wall = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  const y = wall.getUTCFullYear();
  const m = wall.getUTCMonth();
  const d = wall.getUTCDate();

  let startWall: number;
  switch (period) {
    case 'DAY':
      startWall = Date.UTC(y, m, d);
      break;
    case 'WEEK': {
      // getUTCDay(): 0=domingo. Lunes como día 0 de la semana.
      const dow = (wall.getUTCDay() + 6) % 7;
      startWall = Date.UTC(y, m, d - dow);
      break;
    }
    case 'MONTH':
      startWall = Date.UTC(y, m, 1);
      break;
    case 'YEAR':
      startWall = Date.UTC(y, 0, 1);
      break;
    default:
      return null;
  }
  return new Date(startWall + BOGOTA_OFFSET_MS);
}

/** Texto para la UI del canje: "2 por mes", "1 vez", "ilimitado". */
export function describeLimit(
  maxPerMember: number | null | undefined,
  period: BenefitLimitPeriod | null | undefined,
): string {
  if (maxPerMember == null) return 'Ilimitado';
  const p = period ?? 'LIFETIME';
  if (p === 'LIFETIME') {
    return maxPerMember === 1 ? 'Una sola vez' : `${maxPerMember} en total`;
  }
  const label: Record<Exclude<BenefitLimitPeriod, 'LIFETIME'>, string> = {
    DAY: 'por día',
    WEEK: 'por semana',
    MONTH: 'por mes',
    YEAR: 'por año',
  };
  return `${maxPerMember} ${label[p as Exclude<BenefitLimitPeriod, 'LIFETIME'>]}`;
}
