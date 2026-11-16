import { describe, expect, it } from 'vitest';
import { pagoQuePideComision, type NegocioDelPago } from './comision-de-pagos-por-fuera.service';

const ahora = new Date('2026-11-08T05:30:00Z');
const pago = { tenantId: 't', paidAt: new Date('2026-11-07T17:00:00Z') };
// Motilart justo después de `pasar-a-pago-por-fuera` (8-nov 05:19 UTC).
const motilart: NegocioDelPago = {
  status: 'ACTIVE',
  suspendedAt: null,
  lastChargeAt: new Date('2026-11-07T17:00:00Z'),
  currentPeriodEnd: new Date('2026-11-22T12:00:00Z'),
  tieneAfiliado: true,
};

describe('el pago por fuera deja su comisión sin esperar al botón', () => {
  it('Motilart: pago por fuera registrado por script, con afiliados → sí', () => {
    expect(pagoQuePideComision(pago, motilart, ahora)).toBe(true);
  });

  it('sin afiliado asignado → no', () => {
    expect(pagoQuePideComision(pago, { ...motilart, tieneAfiliado: false }, ahora)).toBe(false);
  });

  it('negocio suspendido o no activo → no', () => {
    expect(pagoQuePideComision(pago, { ...motilart, suspendedAt: ahora }, ahora)).toBe(false);
    expect(pagoQuePideComision(pago, { ...motilart, status: 'SUSPENDED' }, ahora)).toBe(false);
  });

  it('ciclo pagado ya vencido → no', () => {
    expect(
      pagoQuePideComision(pago, { ...motilart, currentPeriodEnd: new Date('2026-11-01T00:00:00Z') }, ahora),
    ).toBe(false);
  });

  it('el negocio ya tiene un cobro más nuevo que este pago → no (lo comisiona ese cobro)', () => {
    expect(
      pagoQuePideComision(pago, { ...motilart, lastChargeAt: new Date('2026-11-20T00:00:00Z') }, ahora),
    ).toBe(false);
  });
});
