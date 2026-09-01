import { describe, it, expect } from 'vitest';
import {
  decideDunning,
  pauseDateFor,
  deriveRenewalState,
  type DunningState,
  type DunningConfig,
  type RenewalInput,
  type RenewalConfig,
} from '../src/billing/dunning';

/**
 * Regla de mora — dos comportamientos que se fijan acá:
 *  1) "no suspende al día 6": el reloj se ancla en `firstFailedAt` (inmutable),
 *     no en `lastPaymentAttemptAt` (que Hotmart pisa en cada reintento).
 *  2) DÍAS EN HORA DE BOGOTÁ, 1-INDEXADOS (2026-09-01): el primer día vencido ya
 *     es Día 1 (no hay Día 0). Fallo del cobro → el día del fallo es Día 1. Fin de
 *     ciclo → vence el día SIGUIENTE al fin del período. Suspende al Día 6.
 *
 * `DAY0` se fija a la MEDIANOCHE DE BOGOTÁ (05:00Z) para que `day(n)` avance por
 * días de calendario de Bogotá limpios.
 */

const CFG: DunningConfig = {
  graceDays: 5,
  reminderDay: 1,
  noticeDay: 2,
  staleCapDays: 60,
};

// Medianoche de Bogotá del 2026-08-01 (= 05:00Z). day(n) = +n días de Bogotá.
const DAY0 = new Date('2026-08-01T05:00:00.000Z');
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
  // firstFailedAt = DAY0 → el DÍA DEL FALLO es Día 1. Día N cae en day(N-1).
  const failing = state({ failedPaymentCount: 1, firstFailedAt: DAY0 });

  it('el día del fallo YA es Día 1 (no hay Día 0)', () => {
    const d = decideDunning(failing, DAY0, CFG);
    expect(d.daysOverdue).toBe(1);
    expect(d.byFailure).toBe(true);
    expect(d.action).toBe('reminder'); // Día 1 = recordatorio
  });

  it('al Día 5 sigue en gracia (NO suspende) — este era el reclamo', () => {
    const d = decideDunning(failing, day(4), CFG); // Día 5
    expect(d.daysOverdue).toBe(5);
    expect(d.action).not.toBe('suspend');
    expect(d.action).toBe('none'); // día intermedio de gracia
  });

  it('al Día 6 SÍ suspende', () => {
    const d = decideDunning(failing, day(5), CFG); // Día 6
    expect(d.daysOverdue).toBe(6);
    expect(d.action).toBe('suspend');
  });

  it('ancla INMUTABLE: aunque Hotmart reintente y mueva lastPaymentAttemptAt, suspende al Día 6', () => {
    const retried = state({
      failedPaymentCount: 4,
      firstFailedAt: DAY0,
      lastPaymentAttemptAt: day(4),
    });
    const d = decideDunning(retried, day(5), CFG); // Día 6
    expect(d.dueSince).toEqual(DAY0);
    expect(d.action).toBe('suspend');
  });

  it('fallback legacy: sin firstFailedAt usa lastPaymentAttemptAt', () => {
    const legacy = state({
      failedPaymentCount: 1,
      firstFailedAt: null,
      lastPaymentAttemptAt: DAY0,
    });
    const d = decideDunning(legacy, day(5), CFG); // Día 6
    expect(d.dueSince).toEqual(DAY0);
    expect(d.byFailure).toBe(true);
    expect(d.action).toBe('suspend');
  });

  it('cobro fallido NO tiene tope legacy: suspende aunque sean 61 días', () => {
    const old = state({ failedPaymentCount: 1, firstFailedAt: DAY0 });
    const d = decideDunning(old, day(61), CFG);
    expect(d.action).toBe('suspend');
  });

  it('Día 1 → recordatorio, Día 2 → aviso de pausa', () => {
    expect(decideDunning(failing, DAY0, CFG).action).toBe('reminder'); // Día 1
    expect(decideDunning(failing, day(1), CFG).action).toBe('notice'); // Día 2
  });
});

describe('decideDunning — pago por fuera / fecha vencida', () => {
  // currentPeriodEnd = DAY0 → vence el DÍA SIGUIENTE. Día N cae en day(N).
  it('el día del vencimiento mismo NO está en mora todavía (no hay Día 0)', () => {
    // currentPeriodEnd = DAY0 (medianoche Bogotá); mismo día por la tarde.
    const dueEarlierToday = state({ currentPeriodEnd: DAY0 });
    const d = decideDunning(dueEarlierToday, new Date(DAY0.getTime() + 12 * 3600 * 1000), CFG);
    expect(d.dueSince).toBeNull();
    expect(d.action).toBe('none');
  });

  it('pago por fuera vencido: al Día 6 SÍ suspende (decisión del dueño 2026-08-31)', () => {
    const manual = state({ currentPeriodEnd: DAY0, lastChargeAt: null });
    const d = decideDunning(manual, day(6), CFG); // Día 6
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

// ── Fase 2: estado de renovación ────────────────────────────────────────────

const RCFG: RenewalConfig = { ...CFG, proximoCobroDays: 7 };

function rstate(over: Partial<RenewalInput> = {}): RenewalInput {
  return {
    status: 'ACTIVE',
    suspendedAt: null,
    failedPaymentCount: 0,
    firstFailedAt: null,
    lastPaymentAttemptAt: null,
    currentPeriodEnd: null,
    lastChargeAt: null,
    ...over,
  };
}

describe('deriveRenewalState — estados terminales', () => {
  it('suspendedAt seteado → SUSPENDIDO', () => {
    const r = deriveRenewalState(rstate({ suspendedAt: DAY0 }), day(3), RCFG);
    expect(r.state).toBe('SUSPENDIDO');
  });
  it('status SUSPENDED → SUSPENDIDO', () => {
    expect(deriveRenewalState(rstate({ status: 'SUSPENDED' }), day(3), RCFG).state).toBe('SUSPENDIDO');
  });
  it('status CANCELED → CANCELADO', () => {
    expect(deriveRenewalState(rstate({ status: 'CANCELED' }), day(3), RCFG).state).toBe('CANCELADO');
  });
  it('status TRIAL → TRIAL', () => {
    expect(deriveRenewalState(rstate({ status: 'TRIAL' }), day(3), RCFG).state).toBe('TRIAL');
  });
});

describe('deriveRenewalState — mora (EN_GRACIA)', () => {
  // firstFailedAt = DAY0 → Día 1 = DAY0; Día N cae en day(N-1).
  const failing = rstate({ failedPaymentCount: 1, firstFailedAt: DAY0 });

  it('Día 3 → EN_GRACIA, "Día 3 de 5", 3 días para suspender', () => {
    const r = deriveRenewalState(failing, day(2), RCFG); // Día 3
    expect(r.state).toBe('EN_GRACIA');
    expect(r.graceLabel).toBe('Día 3 de 5');
    expect(r.graceDaysLeft).toBe(3); // 5+1-3
    expect(r.byFailure).toBe(true);
  });

  it('Día 5 (último de gracia) → "Día 5 de 5", 1 día para suspender', () => {
    const r = deriveRenewalState(failing, day(4), RCFG); // Día 5
    expect(r.state).toBe('EN_GRACIA');
    expect(r.graceLabel).toBe('Día 5 de 5');
    expect(r.graceDaysLeft).toBe(1);
  });

  it('Día 6 → EN_GRACIA con 0 días (el cron lo suspenderá) — cae en 🔴 no procesados', () => {
    const r = deriveRenewalState(failing, day(5), RCFG); // Día 6
    expect(r.state).toBe('EN_GRACIA');
    expect(r.graceDaysLeft).toBe(0);
    expect(r.graceLabel).toBe('Día 5 de 5'); // etiqueta topa en graceDays
  });

  it('pago por fuera vencido: al Día 6 → EN_GRACIA (byFailure=false)', () => {
    const manual = rstate({ currentPeriodEnd: DAY0, lastChargeAt: null });
    const r = deriveRenewalState(manual, day(6), RCFG); // Día 6
    expect(r.state).toBe('EN_GRACIA');
    expect(r.byFailure).toBe(false);
  });
});

describe('deriveRenewalState — al día', () => {
  it('cobro dentro de 3 días → COBRO_PROXIMO', () => {
    const r = deriveRenewalState(rstate({ currentPeriodEnd: day(3) }), DAY0, RCFG);
    expect(r.state).toBe('COBRO_PROXIMO');
    expect(r.nextChargeAt).toEqual(day(3));
  });

  it('cobro hoy mismo → COBRO_PROXIMO (0 días)', () => {
    const r = deriveRenewalState(rstate({ currentPeriodEnd: DAY0 }), DAY0, RCFG);
    expect(r.state).toBe('COBRO_PROXIMO');
  });

  it('cobro dentro de 30 días → AL_DIA', () => {
    const r = deriveRenewalState(rstate({ currentPeriodEnd: day(30) }), DAY0, RCFG);
    expect(r.state).toBe('AL_DIA');
    expect(r.nextChargeAt).toEqual(day(30));
  });

  it('renovado (lastChargeAt ≥ fin de ciclo) aunque la fecha ya pasó → AL_DIA, no mora', () => {
    const r = deriveRenewalState(
      rstate({ currentPeriodEnd: DAY0, lastChargeAt: DAY0 }),
      day(6),
      RCFG,
    );
    expect(r.state).toBe('AL_DIA');
  });
});
