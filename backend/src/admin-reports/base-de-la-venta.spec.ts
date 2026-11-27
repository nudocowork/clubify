import { describe, it, expect } from 'vitest';
import { baseDeLaVenta } from './admin-reports.service';

/**
 * «Facturación» en Rankings era la misma suma que «Comisiones»: las dos
 * pestañas daban la misma cifra. Ahora es lo que pagó el cliente en la venta.
 */
describe('baseDeLaVenta', () => {
  it('usa la base guardada en la comisión', () => {
    expect(baseDeLaVenta({ amount: 10, baseAmountUsd: 50, appliedPercent: 20 })).toBe(50);
  });

  it('una comisión vieja sin base se reconstruye con su porcentaje', () => {
    expect(baseDeLaVenta({ amount: 27, baseAmountUsd: null, appliedPercent: 20 })).toBe(135);
  });

  it('sin base ni porcentaje no inventa nada', () => {
    expect(baseDeLaVenta({ amount: 27, baseAmountUsd: null, appliedPercent: null })).toBe(0);
    expect(baseDeLaVenta({ amount: 27, baseAmountUsd: 0, appliedPercent: 0 })).toBe(0);
  });

  it('acepta los Decimal de Prisma como texto', () => {
    expect(baseDeLaVenta({ amount: '10.00', baseAmountUsd: '49.52', appliedPercent: '20.00' })).toBe(49.52);
  });
});
