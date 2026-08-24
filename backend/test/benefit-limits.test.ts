import { describe, it, expect } from 'vitest';
import {
  benefitPeriodStart,
  describeLimit,
} from '../src/cuponera/benefit-limits';

// Bogotá = UTC-5 sin DST. Las 00:00 de Bogotá son las 05:00 UTC del mismo día.
const utc = (s: string) => new Date(s);

describe('benefitPeriodStart', () => {
  it('LIFETIME (y null/undefined) no acota: cuenta todo el historial', () => {
    const now = utc('2026-08-24T18:00:00.000Z');
    expect(benefitPeriodStart('LIFETIME', now)).toBeNull();
    expect(benefitPeriodStart(null, now)).toBeNull();
    expect(benefitPeriodStart(undefined, now)).toBeNull();
  });

  it('DAY arranca a las 00:00 de Bogotá = 05:00 UTC del mismo día', () => {
    const now = utc('2026-08-24T18:00:00.000Z'); // 13:00 en Bogotá
    expect(benefitPeriodStart('DAY', now)!.toISOString()).toBe('2026-08-24T05:00:00.000Z');
  });

  it('DAY: a las 02:00 UTC todavía es el día ANTERIOR en Bogotá', () => {
    // 2026-08-24T02:00Z = 2026-08-23 21:00 en Bogotá → el día es el 23.
    const now = utc('2026-08-24T02:00:00.000Z');
    expect(benefitPeriodStart('DAY', now)!.toISOString()).toBe('2026-08-23T05:00:00.000Z');
  });

  it('MONTH arranca el 1° a las 00:00 de Bogotá', () => {
    const now = utc('2026-08-24T18:00:00.000Z');
    expect(benefitPeriodStart('MONTH', now)!.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });

  it('MONTH: el 1° a las 02:00 UTC sigue siendo el mes ANTERIOR en Bogotá', () => {
    // 2026-09-01T02:00Z = 2026-08-31 21:00 en Bogotá → todavía agosto.
    const now = utc('2026-09-01T02:00:00.000Z');
    expect(benefitPeriodStart('MONTH', now)!.toISOString()).toBe('2026-08-01T05:00:00.000Z');
  });

  it('WEEK arranca el LUNES', () => {
    // 2026-08-24 es lunes. A media semana (jueves 27) la ventana sigue siendo el 24.
    const lunes = utc('2026-08-24T18:00:00.000Z');
    const jueves = utc('2026-08-27T18:00:00.000Z');
    expect(benefitPeriodStart('WEEK', lunes)!.toISOString()).toBe('2026-08-24T05:00:00.000Z');
    expect(benefitPeriodStart('WEEK', jueves)!.toISOString()).toBe('2026-08-24T05:00:00.000Z');
  });

  it('WEEK: el DOMINGO pertenece a la semana que empezó el lunes anterior', () => {
    // 2026-08-30 es domingo → su lunes es el 24, no el 31.
    const domingo = utc('2026-08-30T18:00:00.000Z');
    expect(benefitPeriodStart('WEEK', domingo)!.toISOString()).toBe('2026-08-24T05:00:00.000Z');
  });

  it('WEEK cruza el cambio de mes sin romperse', () => {
    // 2026-09-02 (miércoles) → lunes 2026-08-31.
    const now = utc('2026-09-02T18:00:00.000Z');
    expect(benefitPeriodStart('WEEK', now)!.toISOString()).toBe('2026-08-31T05:00:00.000Z');
  });

  it('YEAR arranca el 1 de enero de Bogotá', () => {
    const now = utc('2026-08-24T18:00:00.000Z');
    expect(benefitPeriodStart('YEAR', now)!.toISOString()).toBe('2026-01-01T05:00:00.000Z');
  });

  it('YEAR: el 1-ene a las 02:00 UTC sigue siendo el año ANTERIOR en Bogotá', () => {
    const now = utc('2026-01-01T02:00:00.000Z'); // 2025-12-31 21:00 Bogotá
    expect(benefitPeriodStart('YEAR', now)!.toISOString()).toBe('2025-01-01T05:00:00.000Z');
  });

  it('el inicio de la ventana nunca queda en el futuro', () => {
    for (const p of ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const) {
      for (const iso of [
        '2026-08-24T05:00:00.000Z', // 00:00 exacto en Bogotá
        '2026-01-01T04:59:59.999Z', // un ms antes del año nuevo Bogotá
        '2026-12-31T23:59:59.999Z',
      ]) {
        const now = utc(iso);
        expect(benefitPeriodStart(p, now)!.getTime()).toBeLessThanOrEqual(now.getTime());
      }
    }
  });
});

describe('describeLimit', () => {
  it('sin tope es ilimitado', () => {
    expect(describeLimit(null, 'MONTH')).toBe('Ilimitado');
    expect(describeLimit(undefined, 'LIFETIME')).toBe('Ilimitado');
  });

  it('LIFETIME distingue "una sola vez" de un total mayor', () => {
    expect(describeLimit(1, 'LIFETIME')).toBe('Una sola vez');
    expect(describeLimit(3, 'LIFETIME')).toBe('3 en total');
    expect(describeLimit(1, null)).toBe('Una sola vez');
  });

  it('los períodos se leen como los escribe el spec', () => {
    expect(describeLimit(2, 'MONTH')).toBe('2 por mes');
    expect(describeLimit(1, 'DAY')).toBe('1 por día');
    expect(describeLimit(5, 'WEEK')).toBe('5 por semana');
    expect(describeLimit(4, 'YEAR')).toBe('4 por año');
  });
});
