import { periodoDe } from '../club/club-periodo';

/**
 * El período contable de Clubify: el MES, en hora de Bogotá.
 *
 * Cada mes es un período cerrado: ni los movimientos ni las métricas de dos
 * meses se mezclan. Este fichero es el único sitio donde se decide a qué mes
 * pertenece un instante y dónde empieza y termina ese mes.
 *
 * Va en hora local y no en UTC a propósito, por lo mismo que ya documenta
 * `club-periodo.ts`: una venta del 31 de agosto a las 8 de la noche en Bogotá
 * son las 01:00 UTC del 1 de septiembre. Contada en UTC, esa venta aparecería
 * en septiembre y descuadraría el cierre de agosto contra lo que el dueño ve
 * en su extracto. Se reusa `periodoDe` en vez de reimplementarlo para que no
 * existan dos definiciones de "en qué mes cae esto" que puedan divergir.
 *
 * OJO: `monthKey()` de `common/period-key.ts` sigue en UTC y NO se toca — es
 * componente del UNIQUE (referralUseId, recipientCodeId, periodKey) de
 * Commission, y moverlo cambiaría la deduplicación de comisiones ya guardadas.
 */

/** Offset fijo de Bogotá: UTC-5 todo el año (Colombia no tiene horario de verano). */
const OFFSET_BOGOTA_HORAS = 5;

/** El mes contable de un instante: "2026-09". */
export function mesContable(fecha: Date): string {
  return periodoDe(fecha);
}

/** El mes contable de hoy. */
export function mesContableActual(ahora: Date = new Date()): string {
  return mesContable(ahora);
}

/**
 * Bordes de un mes "YYYY-MM" como instantes UTC: desde las 00:00:00.000 hasta
 * las 23:59:59.999 de Bogotá. Devuelve `null` si el período no tiene formato.
 */
export function limitesDelMes(
  periodo: string,
): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return null;
  const y = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return {
    from: new Date(Date.UTC(y, mes - 1, 1, OFFSET_BOGOTA_HORAS, 0, 0, 0)),
    // Día 0 del mes siguiente = último día de este mes.
    to: new Date(Date.UTC(y, mes, 0, 23 + OFFSET_BOGOTA_HORAS, 59, 59, 999)),
  };
}

/** Corre un período N meses hacia atrás: ("2026-01", 1) → "2025-12". */
export function mesAtras(periodo: string, meses: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return periodo;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 - meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
