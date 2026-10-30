import { describe, expect, it } from 'vitest';
import { estadoComercial, type DatosDeEstadoComercial } from './estado-comercial';

const fecha = new Date('2026-10-01T12:00:00Z');
const base: DatosDeEstadoComercial = {
  status: 'ACTIVE',
  canceledAt: null,
  trialEndsAt: null,
  lastChargeAt: fecha,
  currentPeriodEnd: fecha,
};

describe('estadoComercial', () => {
  it('quien cancela es CANCELADO aunque siga con período pagado', () => {
    expect(estadoComercial({ ...base, canceledAt: fecha })).toBe('CANCELADO');
  });

  it('quien canceló y ya se suspendió sigue siendo CANCELADO, no moroso', () => {
    expect(estadoComercial({ ...base, status: 'SUSPENDED', canceledAt: fecha })).toBe('CANCELADO');
  });

  it('el trial vencido que nunca pagó es SUSPENDIDO_TRIAL', () => {
    expect(
      estadoComercial({
        ...base,
        status: 'SUSPENDED',
        trialEndsAt: fecha,
        lastChargeAt: null,
        currentPeriodEnd: null,
      }),
    ).toBe('SUSPENDIDO_TRIAL');
  });

  it('quien pagó después de probar y dejó de pagar es SUSPENDIDO', () => {
    expect(estadoComercial({ ...base, status: 'SUSPENDED', trialEndsAt: fecha })).toBe('SUSPENDIDO');
  });

  it('un suspendido sin prueba es SUSPENDIDO aunque no tenga cobro registrado', () => {
    expect(
      estadoComercial({ ...base, status: 'SUSPENDED', lastChargeAt: null, currentPeriodEnd: null }),
    ).toBe('SUSPENDIDO');
  });

  it('activo y trial se leen tal cual', () => {
    expect(estadoComercial(base)).toBe('ACTIVO');
    expect(estadoComercial({ ...base, status: 'TRIAL' })).toBe('TRIAL');
  });
});
