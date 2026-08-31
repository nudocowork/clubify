import { describe, it, expect } from 'vitest';
import {
  decideDunning,
  pauseDateFor,
  type DunningState,
  type DunningConfig,
} from '../src/billing/dunning';

/**
 * Regla de mora — el caso que fallaba en producción: "no suspende al día 6".
 *
 * La causa raíz era que el reloj de gracia se anclaba en `lastPaymentAttemptAt`,
 * que Hotmart pisa a `now` en cada reintento → la mora volvía a 0 y nunca
 * llegaba al umbral. La corrección: anclar en `firstFailedAt` (inmutable) y
 * suspender al día (graceDays+1). Estos tests fijan ese comportamiento.
 */

const CFG: DunningConfig = {
  graceDays: 5,
  reminderDay: 1,
  noticeDay: 2,
  staleCapDays: 60,
};

// Base fija (sin Date.now): día 0 de la mora.
const DAY0 = new Date('2026-08-01T00:00:00.000Z');
const day = (n: number) => new Date(DAY0.getTime() + n * 24 * 60 * 60 * 1000);

// Negocio sano por defecto; cada test cambia lo que le importa.
function state(over: Partial<DunningState> = {}): DunningState {
  return {
    failedPaymentCount: 0,
    firstFailedAt: null,
    lastPaymentAttemptAt: null,
    currentPeriodEnd: null,
    lastChargeAt: null,
    ...over,
  };
}

describe('decideDunning — cobro fallido (Hotmart/Stripe)', () => {
  const failing = state({ failedPaymentCount: 1, firstFailedAt: DAY0 });

  it('al día 5 sigue en gracia (NO suspende) — este era el reclamo', () => {
    const d = decideDunning(failing, day(5), CFG);
    expect(d.daysOverdue).toBe(5);
    expect(d.byFailure).toBe(true);
    expect(d.action).not.toBe('suspend');
    expect(d.action).toBe('none'); // día intermedio de gracia
  });

  it('al día 6 SÍ suspende', () => {
    const d = decideDunning(failing, day(6), CFG);
    expect(d.daysOverdue).toBe(6);
    expect(d.action).toBe('suspend');
  });

  it('ancla INMUTABLE: aunque Hotmart reintente y mueva lastPaymentAttemptAt, suspende al día 6', () => {
    // firstFailedAt fijo en día 0; Hotmart reintentó en día 5 (lo típico que
    // reiniciaba el reloj). Debe seguir contando desde día 0 → suspende.
    const retried = state({
      failedPaymentCount: 4,
      firstFailedAt: DAY0,
      lastPaymentAttemptAt: day(5),
    });
    const d = decideDunning(retried, day(6), CFG);
    expect(d.dueSince).toEqual(DAY0);
    expect(d.action).toBe('suspend');
  });

  it('fallback legacy: sin firstFailedAt usa lastPaymentAttemptAt', () => {
    const legacy = state({
      failedPaymentCount: 1,
      firstFailedAt: null,
      lastPaymentAttemptAt: DAY0,
    });
    const d = decideDunning(legacy, day(6), CFG);
    expect(d.dueSince).toEqual(DAY0);
    expect(d.byFailure).toBe(true);
    expect(d.action).toBe('suspend');
  });

  it('cobro fallido NO tiene tope legacy: suspende aunque sean 61 días', () => {
    const old = state({ failedPaymentCount: 1, firstFailedAt: DAY0 });
    const d = decideDunning(old, day(61), CFG);
    expect(d.action).toBe('suspend');
  });

  it('D+1 → recordatorio, D+2 → aviso de pausa', () => {
    expect(decideDunning(failing, day(1), CFG).action).toBe('reminder');
    expect(decideDunning(failing, day(2), CFG).action).toBe('notice');
  });

  it('mismo día del fallo (D+0) → sin acción', () => {
    expect(decideDunning(failing, day(0), CFG).action).toBe('none');
  });
});

describe('decideDunning — pago por fuera / fecha vencida', () => {
  it('pago por fuera vencido hace 6 días SÍ suspende (decisión del dueño 2026-08-31)', () => {
    // manualPayment no está en el estado: el ancla es currentPeriodEnd. Sin
    // failedPaymentCount → byFailure=false, pero igual suspende al día 6.
    const manual = state({ currentPeriodEnd: DAY0, lastChargeAt: null });
    const d = decideDunning(manual, day(6), CFG);
    expect(d.byFailure).toBe(false);
    expect(d.dueSince).toEqual(DAY0);
    expect(d.action).toBe('suspend');
  });

  it('fecha vencida pero RENOVADA (lastChargeAt ≥ fin de ciclo) → sin mora', () => {
    const renewed = state({ currentPeriodEnd: DAY0, lastChargeAt: DAY0 });
    const d = decideDunning(renewed, day(6), CFG);
    expect(d.dueSince).toBeNull();
    expect(d.action).toBe('none');
  });

  it('tope legacy: vencido por FECHA hace 61 días → stale-skip (no auto-pausa masiva)', () => {
    const stale = state({ currentPeriodEnd: DAY0, lastChargeAt: null });
    const d = decideDunning(stale, day(61), CFG);
    expect(d.action).toBe('stale-skip');
  });

  it('al día natural del cobro (currentPeriodEnd hoy, no pasado) → sin mora', () => {
    const dueToday = state({ currentPeriodEnd: day(6) });
    const d = decideDunning(dueToday, day(6), CFG);
    expect(d.action).toBe('none');
  });
});

describe('pauseDateFor', () => {
  it('con 5 días de gracia, la fecha de pausa es el día 6', () => {
    expect(pauseDateFor(DAY0, 5)).toEqual(day(6));
  });
});
