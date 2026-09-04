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

/**
 * Límites de cualquier período que sepa pedir el panel:
 *
 *   "2026-09"    → ese mes
 *   "2026-T3"    → ese trimestre (julio a septiembre)
 *   "2026"       → ese año
 *   "todo" / ""  → sin límites (histórico completo)
 *
 * Todo en hora de Bogotá, apoyado en `limitesDelMes` para que el borde del
 * período sea el MISMO en las tres granularidades. Devuelve `null` si el
 * período no se entiende, para que quien llama decida si es un 400 o si cae
 * al mes en curso.
 */
export function limitesDelPeriodo(
  periodo: string | undefined | null,
): { from?: Date; to?: Date } | null {
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return {};

  const mes = limitesDelMes(p);
  if (mes) return mes;

  const t = /^(\d{4})-T([1-4])$/i.exec(p);
  if (t) {
    const primerMes = (Number(t[2]) - 1) * 3 + 1;
    const desde = limitesDelMes(`${t[1]}-${String(primerMes).padStart(2, '0')}`)!;
    const hasta = limitesDelMes(`${t[1]}-${String(primerMes + 2).padStart(2, '0')}`)!;
    return { from: desde.from, to: hasta.to };
  }

  const anio = /^(\d{4})$/.exec(p);
  if (anio) {
    return {
      from: limitesDelMes(`${anio[1]}-01`)!.from,
      to: limitesDelMes(`${anio[1]}-12`)!.to,
    };
  }
  return null;
}

/** Etiqueta legible de un período, para títulos y mensajes. */
export function nombreDelPeriodo(periodo: string): string {
  const p = (periodo ?? '').trim();
  if (!p || p === 'todo') return 'Todo el histórico';
  const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const m = /^(\d{4})-(\d{2})$/.exec(p);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return `${MESES[Number(m[2]) - 1]} de ${m[1]}`;
  }
  const t = /^(\d{4})-T([1-4])$/i.exec(p);
  if (t) return `${t[2]}º trimestre de ${t[1]}`;
  if (/^\d{4}$/.test(p)) return `año ${p}`;
  return p;
}
