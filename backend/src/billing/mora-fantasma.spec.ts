import { describe, it, expect } from 'vitest';
import { esMoraFantasma, type DunningState } from './dunning';

/**
 * Distinguir la mora FANTASMA de la mora REAL.
 *
 * Las dos se ven igual en la base —`failedPaymentCount > 0` con el ciclo
 * apuntando al futuro— y confundirlas cuesta dinero en los dos sentidos:
 *
 *  · Tratar un fantasma como mora → le mandas «pago pendiente» a quien ya pagó
 *    (el caso Quipao, que originó el candado).
 *  · Tratar una mora real como fantasma → **MYKOZ**: se le borró un
 *    `PURCHASE_DELAYED` del 2026-09-03, figuró al día, no recibió ni un aviso
 *    y no se suspendió, con su último cobro real en abril.
 *
 * Lo que las separa NO es la fecha del ciclo: es si PAGÓ DESPUÉS DEL FALLO.
 */

const AHORA = new Date('2026-09-11T13:00:00Z');
const FUTURO = new Date('2026-10-11T12:32:16Z');

function estado(p: Partial<DunningState>): DunningState {
  return {
    failedPaymentCount: 0,
    firstFailedAt: null,
    lastPaymentAttemptAt: null,
    currentPeriodEnd: null,
    lastChargeAt: null,
    ...p,
  };
}

describe('esMoraFantasma', () => {
  it('EL CASO MYKOZ: fallo nuevo y último cobro viejo NO es fantasma', () => {
    // Tal cual estaba en producción: ciclo hasta octubre, fallo el 3-sep,
    // último cobro real el 1 de abril.
    const mykoz = estado({
      failedPaymentCount: 1,
      firstFailedAt: new Date('2026-09-03T14:00:00Z'),
      currentPeriodEnd: FUTURO,
      lastChargeAt: new Date('2026-04-01T12:32:16Z'),
    });
    expect(esMoraFantasma(mykoz, AHORA)).toBe(false);
  });

  it('EL CASO QUIPAO: pagó DESPUÉS del fallo → sí es fantasma', () => {
    // Para esto se hizo el candado: el pago entró, la fecha se quedó atrás y
    // el contador viejo hacía que se le reclamara a quien estaba al día.
    const quipao = estado({
      failedPaymentCount: 1,
      firstFailedAt: new Date('2026-08-01T10:00:00Z'),
      currentPeriodEnd: FUTURO,
      lastChargeAt: new Date('2026-08-05T10:00:00Z'),
    });
    expect(esMoraFantasma(quipao, AHORA)).toBe(true);
  });

  it('sin ningún cobro registrado y con un fallo, NO es fantasma', () => {
    const nunca = estado({
      failedPaymentCount: 2,
      firstFailedAt: new Date('2026-09-03T14:00:00Z'),
      currentPeriodEnd: FUTURO,
      lastChargeAt: null,
    });
    expect(esMoraFantasma(nunca, AHORA)).toBe(false);
  });

  it('el ciclo YA VENCIDO nunca es fantasma, pagara cuando pagara', () => {
    const vencido = estado({
      failedPaymentCount: 1,
      firstFailedAt: new Date('2026-08-01T10:00:00Z'),
      currentPeriodEnd: new Date('2026-09-01T10:00:00Z'),
      lastChargeAt: new Date('2026-08-05T10:00:00Z'),
    });
    expect(esMoraFantasma(vencido, AHORA)).toBe(false);
  });

  it('sin fallos no hay nada que limpiar', () => {
    expect(
      esMoraFantasma(estado({ failedPaymentCount: 0, currentPeriodEnd: FUTURO }), AHORA),
    ).toBe(false);
  });

  it('datos legacy sin ancla del fallo: se mantiene el comportamiento viejo', () => {
    // Sin `firstFailedAt` no se puede fechar el fallo. Ahi se prefiere el
    // riesgo antiguo (dejar pasar uno) al de acosar a quien ya pago.
    const legacy = estado({
      failedPaymentCount: 3,
      firstFailedAt: null,
      currentPeriodEnd: FUTURO,
      lastChargeAt: new Date('2026-04-01T12:00:00Z'),
    });
    expect(esMoraFantasma(legacy, AHORA)).toBe(true);
  });

  it('un cobro EXACTAMENTE a la vez que el fallo no cuenta como pagado despues', () => {
    const mismoInstante = new Date('2026-09-03T14:00:00Z');
    const t = estado({
      failedPaymentCount: 1,
      firstFailedAt: mismoInstante,
      currentPeriodEnd: FUTURO,
      lastChargeAt: mismoInstante,
    });
    expect(esMoraFantasma(t, AHORA)).toBe(false);
  });
});
