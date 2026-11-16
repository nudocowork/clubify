import { describe, expect, it } from 'vitest';
import { pagoConFechaVieja } from './pago-con-fecha-vieja';

const f = (s: string) => new Date(`${s}T12:00:00Z`);

describe('pago con fecha vieja (blindaje anti-desincronización)', () => {
  it('La Burguesía: con Hotmart, pagar tarde NO corre la fecha un mes', () => {
    // Pagó el 29-oct el cobro del 16-oct; Hotmart dice próximo cobro 16-nov.
    expect(
      pagoConFechaVieja({
        lastChargeAt: f('2026-10-29'),
        currentPeriodEnd: f('2026-11-16'),
        planPeriodicity: 'MENSUAL',
        hotmartSubscriberCode: 'L5OJ250G',
      }),
    ).toBe(false);
  });

  it('con Hotmart, un pago que entró después de la fecha sí la deja vieja', () => {
    expect(
      pagoConFechaVieja({
        lastChargeAt: f('2026-11-16'),
        currentPeriodEnd: f('2026-11-16'),
        planPeriodicity: 'MENSUAL',
        hotmartSubscriberCode: 'L5OJ250G',
      }),
    ).toBe(true);
  });

  it('sin Hotmart sigue viendo una fecha que avanzó de menos (Quipao)', () => {
    expect(
      pagoConFechaVieja({
        lastChargeAt: f('2026-10-01'),
        currentPeriodEnd: f('2026-10-20'),
        planPeriodicity: 'MENSUAL',
        hotmartSubscriberCode: null,
      }),
    ).toBe(true);
  });

  it('Motilart: pago por fuera anclado a su vencimiento NO corre la fecha un mes', () => {
    // Pagó por fuera el 7-nov el ciclo del 22-oct; próximo cobro 22-nov.
    expect(
      pagoConFechaVieja({
        lastChargeAt: f('2026-11-07'),
        currentPeriodEnd: f('2026-11-22'),
        planPeriodicity: 'MENSUAL',
        hotmartSubscriberCode: null,
        manualPayment: true,
      }),
    ).toBe(false);
  });

  it('una fecha al día no es vieja', () => {
    expect(
      pagoConFechaVieja({
        lastChargeAt: f('2026-10-16'),
        currentPeriodEnd: f('2026-11-16'),
        planPeriodicity: 'MENSUAL',
        hotmartSubscriberCode: null,
      }),
    ).toBe(false);
  });

  it('sin pago o sin fecha no decide nada', () => {
    expect(pagoConFechaVieja({ lastChargeAt: null, currentPeriodEnd: f('2026-11-16'), planPeriodicity: 'MENSUAL' })).toBe(false);
  });
});
