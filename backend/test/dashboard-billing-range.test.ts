import { describe, expect, it } from 'vitest';
import { resolveDateRange } from '../src/admin-reports/admin-reports.service';
import { bogotaYmd } from '../src/referrals/cutoff-calendar';

/**
 * Invariantes del panel de facturación (auditoría 2026-08-17). Solo prueban la
 * resolución de rangos (función pura); la aritmética buckets==total y
 * modal==header se valida contra la DB en el script de reconciliación.
 */

// Instante de referencia: 2026-08-17 10:00 UTC = 2026-08-17 05:00 Bogotá.
const NOW = new Date('2026-08-17T10:00:00.000Z');

describe('resolveDateRange — timezone canónico Bogotá (Bug 6)', () => {
  it('today arranca en la MEDIANOCHE de Bogotá (05:00 UTC), no en medianoche UTC', () => {
    const { from, to } = resolveDateRange('today', undefined, undefined, NOW);
    expect(from.toISOString()).toBe('2026-08-17T05:00:00.000Z');
    expect(to.toISOString()).toBe(NOW.toISOString());
  });

  it('un pago a las 20:00 de Bogotá cae en su día local, no se corre al siguiente', () => {
    // 20:00 Bogotá del 16-ago = 01:00 UTC del 17-ago.
    const pago = new Date('2026-08-17T01:00:00.000Z');
    expect(bogotaYmd(pago)).toBe('2026-08-16'); // es del 16 en Bogotá
    const { from } = resolveDateRange('today', undefined, undefined, NOW);
    // "Hoy" (17-ago Bogotá) NO debe incluir ese pago del 16.
    expect(pago.getTime() < from.getTime()).toBe(true);
  });

  it('this-year arranca el 1 de enero de Bogotá (05:00 UTC del 1-ene)', () => {
    const { from } = resolveDateRange('this-year', undefined, undefined, NOW);
    expect(from.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('this-week arranca un LUNES a medianoche de Bogotá', () => {
    const { from } = resolveDateRange('this-week', undefined, undefined, NOW);
    expect(from.getUTCDay()).toBe(1); // lunes (00:00 Bogotá = 05:00Z, mismo día)
    expect(from.toISOString().endsWith('T05:00:00.000Z')).toBe(true);
    const today = resolveDateRange('today', undefined, undefined, NOW).from;
    expect(from.getTime()).toBeLessThanOrEqual(today.getTime());
  });
});

describe('resolveDateRange — monotonía por subconjunto (invariante del panel)', () => {
  it('today ⊆ this-week ⊆ last-30 ⊆ this-quarter ⊆ this-year (froms anidados)', () => {
    const ranges = [
      'today',
      'this-week',
      'last-30',
      'this-quarter',
      'this-year',
    ] as const;
    const froms = ranges.map(
      (r) => resolveDateRange(r, undefined, undefined, NOW).from.getTime(),
    );
    // Cada rango más AMPLIO arranca ANTES o igual que el más chico:
    // year <= quarter <= last-30 <= week <= today. Un cobro presente en el
    // rango chico está, por definición, en el grande.
    for (let i = 0; i < froms.length - 1; i++) {
      expect(froms[i]).toBeGreaterThanOrEqual(froms[i + 1]);
    }
    const to = resolveDateRange('today', undefined, undefined, NOW).to.getTime();
    froms.forEach((f) => expect(f).toBeLessThanOrEqual(to));
  });
});
