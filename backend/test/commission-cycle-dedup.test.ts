import { describe, it, expect } from 'vitest';
import { monthKey } from '../src/common/period-key';

/**
 * Regresión del bug "3er cobro sin comisión" (Motilart 22-ago, 2026-09-01).
 *
 * MOTILART paga mensual. La comisión de JULIO (businessDate 22-jul) se insertó
 * TARDE, el 30-ago. Dos consecuencias, ambas por deducir el ciclo de la fecha
 * equivocada (`createdAt` / `new Date()` en vez de `businessDate`):
 *
 *  1) periodKey salía de `monthKey()` = mes en que corre el código = '2026-08',
 *     así que colisionaba en la UNIQUE con el cobro real de agosto.
 *  2) reconcileRecurringCommissions deduplicaba por `createdAt ≥ inicioDeCiclo`;
 *     como esa fila se creó el 30-ago (dentro de la ventana del ciclo de agosto),
 *     el cron creía que agosto YA estaba cubierto y saltaba el cobro real.
 *
 * El fix: derivar periodKey del `businessDate` y deduplicar por `businessDate`
 * (el ciclo al que pertenece la comisión), no por `createdAt`.
 */

// Evaluador mínimo del `where` de Prisma, solo con los operadores que usa el
// dedup (igual criterio que el fake de cutoff-generation.test.ts).
function matches(row: Record<string, any>, where: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(cond as any[]).some((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[key];
    if (cond === null) {
      if (v !== null && v !== undefined) return false;
    } else if (cond instanceof Date) {
      if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false;
    } else if (cond && typeof cond === 'object') {
      if ('gte' in cond) {
        if (v === null || v === undefined) return false;
        if (new Date(v).getTime() < new Date(cond.gte).getTime()) return false;
      }
    } else if (v !== cond) return false;
  }
  return true;
}

describe('periodKey se deriva de la fecha del cobro, no de "ahora"', () => {
  it('monthKey(businessDate) devuelve el mes del cobro aunque el código corra otro mes', () => {
    const july = new Date('2026-07-22T13:00:00Z');
    expect(monthKey(july)).toBe('2026-07');
    // Sin argumento cae a new Date() (el bug); con businessDate es determinista.
    expect(monthKey(new Date('2026-08-22T13:49:07Z'))).toBe('2026-08');
  });
});

describe('dedup por ciclo: businessDate, no createdAt', () => {
  // Comisión de JULIO insertada tarde (30-ago). businessDate = ciclo real (jul).
  const julyRow = {
    referralUseId: 'use-A',
    recipientCodeId: 'santiago',
    businessDate: new Date('2026-07-22T13:00:00Z'),
    createdAt: new Date('2026-08-30T08:59:23Z'),
  };
  // Ventana del ciclo de AGOSTO: min(lastChargeAt−2d = 20-ago, cpe−1mes).
  const periodStart = new Date('2026-08-20T00:00:00Z');

  it('CRITERIO VIEJO (createdAt≥inicio) marcaba agosto como cubierto — el bug', () => {
    const oldWhere = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      createdAt: { gte: periodStart },
    };
    // createdAt 30-ago ≥ 20-ago → matchea → reconcile creía cubierto → NO creaba.
    expect(matches(julyRow, oldWhere)).toBe(true);
  });

  it('CRITERIO NUEVO (businessDate≥inicio, fallback createdAt) ve agosto como VACÍO', () => {
    const newWhere = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      OR: [
        { businessDate: { gte: periodStart } },
        { businessDate: null, createdAt: { gte: periodStart } },
      ],
    };
    // businessDate 22-jul < 20-ago, y businessDate no es null → NO matchea →
    // el ciclo de agosto se ve descubierto → SÍ se genera la comisión.
    expect(matches(julyRow, newWhere)).toBe(false);
  });

  it('el criterio nuevo SÍ dedupea una comisión que sí es del ciclo de agosto', () => {
    const augRow = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      businessDate: new Date('2026-08-22T13:49:07Z'),
      createdAt: new Date('2026-08-22T13:49:07Z'),
    };
    const newWhere = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      OR: [
        { businessDate: { gte: periodStart } },
        { businessDate: null, createdAt: { gte: periodStart } },
      ],
    };
    expect(matches(augRow, newWhere)).toBe(true);
  });

  it('filas legacy sin businessDate siguen deduplicándose por createdAt', () => {
    const legacyRow = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      businessDate: null,
      createdAt: new Date('2026-08-25T00:00:00Z'),
    };
    const newWhere = {
      referralUseId: 'use-A',
      recipientCodeId: 'santiago',
      OR: [
        { businessDate: { gte: periodStart } },
        { businessDate: null, createdAt: { gte: periodStart } },
      ],
    };
    expect(matches(legacyRow, newWhere)).toBe(true);
  });
});
