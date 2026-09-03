import { describe, it, expect } from 'vitest';
import { periodoDe, diaDelMes, tocaReiniciar } from './club-periodo';

/**
 * Los bordes del calendario, que es donde se pierde el cupo de la gente.
 *
 * `club-periodo.spec.ts` cubre el caso feliz. Aquí van los instantes en los que
 * un error de una hora cambia el mes de un cliente: el último minuto de un mes,
 * el cambio de año, y la pregunta de si Bogotá se mueve alguna vez respecto a
 * UTC (no: son -5 los doce meses; Colombia no cambia la hora desde 1993).
 */

describe('el último instante de un mes todavía es de ese mes', () => {
  it('las 23:59:59 del 30 de septiembre en Bogotá son septiembre', () => {
    // 04:59:59 UTC del 1 de octubre.
    const f = new Date('2026-10-01T04:59:59Z');
    expect(periodoDe(f)).toBe('2026-09');
    expect(diaDelMes(f)).toBe(30);
  });

  it('un milisegundo después ya es octubre', () => {
    const f = new Date('2026-10-01T05:00:00Z');
    expect(periodoDe(f)).toBe('2026-10');
    expect(diaDelMes(f)).toBe(1);
  });

  it('el 31 de un mes de 31 días se cuenta como 31', () => {
    expect(diaDelMes(new Date('2026-10-31T17:00:00Z'))).toBe(31);
    expect(periodoDe(new Date('2026-10-31T17:00:00Z'))).toBe('2026-10');
  });

  it('febrero de un año bisiesto llega al 29', () => {
    expect(diaDelMes(new Date('2028-02-29T17:00:00Z'))).toBe(29);
    expect(periodoDe(new Date('2028-02-29T17:00:00Z'))).toBe('2028-02');
  });

  it('el 28 de febrero de un año normal es el último', () => {
    expect(periodoDe(new Date('2027-03-01T04:59:00Z'))).toBe('2027-02');
    expect(diaDelMes(new Date('2027-03-01T04:59:00Z'))).toBe(28);
  });
});

describe('el cambio de año', () => {
  it('el 31 de diciembre a las 20:00 de Bogotá sigue siendo diciembre', () => {
    // Ya es 1 de enero en UTC. Contándolo en UTC, a todo el mundo se le
    // cerraría diciembre un día antes.
    const f = new Date('2027-01-01T01:00:00Z');
    expect(periodoDe(f)).toBe('2026-12');
    expect(diaDelMes(f)).toBe(31);
  });

  it('el 1 de enero a las 00:30 de Colombia ya es el año nuevo', () => {
    const f = new Date('2027-01-01T05:30:00Z');
    expect(periodoDe(f)).toBe('2027-01');
    expect(diaDelMes(f)).toBe(1);
  });

  it('el cron reinicia al cruzar el año, no se queda en diciembre', () => {
    expect(tocaReiniciar({ status: 'ACTIVA', periodo: '2026-12' }, '2027-01')).toBe(
      true,
    );
  });
});

describe('Bogotá no cambia la hora en todo el año', () => {
  it('en julio el corte del mes es a la misma hora UTC que en enero', () => {
    // Si algún día se usara una zona con horario de verano, este test avisa:
    // el corte se movería una hora y habría un día con dos períodos posibles.
    expect(periodoDe(new Date('2026-07-01T04:59:00Z'))).toBe('2026-06');
    expect(periodoDe(new Date('2026-07-01T05:00:00Z'))).toBe('2026-07');
    expect(periodoDe(new Date('2026-01-01T04:59:00Z'))).toBe('2025-12');
    expect(periodoDe(new Date('2026-01-01T05:00:00Z'))).toBe('2026-01');
  });
});

describe('el formato del período', () => {
  it('el mes va con dos dígitos: 2026-01, nunca 2026-1', () => {
    // De esto depende que el orden alfabético sea el orden cronológico, que es
    // como se ordenan los informes por período.
    expect(periodoDe(new Date('2026-01-15T17:00:00Z'))).toBe('2026-01');
    expect(periodoDe(new Date('2026-09-15T17:00:00Z'))).toBe('2026-09');
  });

  it('ordenar los períodos como texto los ordena en el tiempo', () => {
    const desordenados = ['2026-10', '2026-09', '2027-01', '2026-12'];
    expect([...desordenados].sort()).toEqual([
      '2026-09',
      '2026-10',
      '2026-12',
      '2027-01',
    ]);
  });

  it('el día también viene como número, no como "05"', () => {
    expect(diaDelMes(new Date('2026-09-05T17:00:00Z'))).toBe(5);
  });
});

describe('cosas que no deberían pasar', () => {
  it('una fecha inválida revienta en vez de inventarse un período', () => {
    // Preferible a devolver "NaN-NaN" y que acabe guardado en una membresía:
    // esa fila no volvería a reiniciarse nunca y nadie sabría por qué.
    expect(() => periodoDe(new Date('no soy una fecha'))).toThrow(RangeError);
    expect(() => diaDelMes(new Date('no soy una fecha'))).toThrow(RangeError);
  });

  it('la zona es un parámetro, y cambiarla cambia el mes', () => {
    const f = new Date('2026-10-01T01:00:00Z');
    expect(periodoDe(f, 'America/Bogota')).toBe('2026-09');
    expect(periodoDe(f, 'UTC')).toBe('2026-10');
  });
});
