import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  bogotaDayEndUtc,
  bogotaDayStartUtc,
  bogotaNoonUtc,
  bogotaYmd,
  cutoffCode,
  cutoffDaysInRange,
  cutoffPeriod,
  daysBetweenYmd,
  isCutoffDay,
  lastDayOfMonth,
  nextCutoffYmd,
} from '../src/referrals/cutoff-calendar';

describe('lastDayOfMonth — nunca hardcodeado', () => {
  it('febrero bisiesto cierra el 29', () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2028, 2)).toBe(29);
  });

  it('febrero normal cierra el 28', () => {
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(2027, 2)).toBe(28);
  });

  it('1900 no es bisiesto y 2000 sí (regla de los siglos)', () => {
    expect(lastDayOfMonth(1900, 2)).toBe(28);
    expect(lastDayOfMonth(2000, 2)).toBe(29);
  });

  it('abril, junio, septiembre y noviembre cierran el 30', () => {
    for (const m of [4, 6, 9, 11]) expect(lastDayOfMonth(2026, m)).toBe(30);
  });

  it('el resto cierra el 31', () => {
    for (const m of [1, 3, 5, 7, 8, 10, 12]) {
      expect(lastDayOfMonth(2026, m)).toBe(31);
    }
  });
});

describe('isCutoffDay', () => {
  it('el 15 siempre es día de corte', () => {
    expect(isCutoffDay('2026-02-15')).toBe(true);
    expect(isCutoffDay('2026-08-15')).toBe(true);
  });

  it('el último día del mes es día de corte, calculado por mes', () => {
    expect(isCutoffDay('2026-02-28')).toBe(true); // año normal
    expect(isCutoffDay('2024-02-29')).toBe(true); // bisiesto
    expect(isCutoffDay('2026-04-30')).toBe(true);
    expect(isCutoffDay('2026-08-31')).toBe(true);
  });

  it('el 28 de febrero de un bisiesto NO es corte (lo es el 29)', () => {
    expect(isCutoffDay('2024-02-28')).toBe(false);
    expect(isCutoffDay('2024-02-29')).toBe(true);
  });

  it('el 30 de un mes de 31 no es corte', () => {
    expect(isCutoffDay('2026-08-30')).toBe(false);
    expect(isCutoffDay('2026-01-30')).toBe(false);
  });

  it('cualquier otro día no es corte', () => {
    for (const d of ['2026-08-01', '2026-08-14', '2026-08-16', '2026-08-20']) {
      expect(isCutoffDay(d)).toBe(false);
    }
  });
});

describe('cutoffPeriod — qué ventana cubre cada corte', () => {
  it('el corte del 15 cubre del 1 al 15', () => {
    expect(cutoffPeriod('2026-08-15')).toEqual({
      start: '2026-08-01',
      end: '2026-08-15',
    });
  });

  it('el corte de fin de mes cubre del 16 al último día', () => {
    expect(cutoffPeriod('2026-08-31')).toEqual({
      start: '2026-08-16',
      end: '2026-08-31',
    });
    expect(cutoffPeriod('2026-02-28')).toEqual({
      start: '2026-02-16',
      end: '2026-02-28',
    });
    expect(cutoffPeriod('2024-02-29')).toEqual({
      start: '2024-02-16',
      end: '2024-02-29',
    });
  });

  it('tira error si no es día de corte', () => {
    expect(() => cutoffPeriod('2026-08-20')).toThrow();
  });
});

describe('nextCutoffYmd', () => {
  it('antes del 15 → el 15', () => {
    expect(nextCutoffYmd('2026-08-01')).toBe('2026-08-15');
    expect(nextCutoffYmd('2026-08-14')).toBe('2026-08-15');
  });

  it('el mismo día de corte se devuelve a sí mismo', () => {
    expect(nextCutoffYmd('2026-08-15')).toBe('2026-08-15');
    expect(nextCutoffYmd('2026-08-31')).toBe('2026-08-31');
  });

  it('después del 15 → fin de mes, calculado', () => {
    expect(nextCutoffYmd('2026-08-16')).toBe('2026-08-31');
    expect(nextCutoffYmd('2026-04-16')).toBe('2026-04-30');
    expect(nextCutoffYmd('2026-02-16')).toBe('2026-02-28');
    expect(nextCutoffYmd('2024-02-16')).toBe('2024-02-29');
  });
});

describe('cutoffDaysInRange — catch-up de cortes no generados', () => {
  it('lista los cortes de un rango de un mes', () => {
    expect(cutoffDaysInRange('2026-08-01', '2026-08-31')).toEqual([
      '2026-08-15',
      '2026-08-31',
    ]);
  });

  it('cruza meses y respeta el último día de cada uno', () => {
    expect(cutoffDaysInRange('2026-01-20', '2026-03-01')).toEqual([
      '2026-01-31',
      '2026-02-15',
      '2026-02-28',
    ]);
  });

  it('bisiesto: el corte de febrero cae el 29', () => {
    expect(cutoffDaysInRange('2024-02-16', '2024-03-01')).toEqual([
      '2024-02-29',
    ]);
  });

  it('rango sin cortes devuelve vacío', () => {
    expect(cutoffDaysInRange('2026-08-16', '2026-08-20')).toEqual([]);
  });

  it('rango invertido devuelve vacío (no cuelga)', () => {
    expect(cutoffDaysInRange('2026-08-31', '2026-08-01')).toEqual([]);
  });
});

describe('aritmética de fechas', () => {
  it('addDaysYmd cruza meses y años', () => {
    expect(addDaysYmd('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDaysYmd('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysYmd('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysYmd('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('daysBetweenYmd', () => {
    expect(daysBetweenYmd('2026-08-15', '2026-08-31')).toBe(16);
    expect(daysBetweenYmd('2026-08-31', '2026-08-15')).toBe(-16);
    expect(daysBetweenYmd('2026-08-15', '2026-08-15')).toBe(0);
  });
});

describe('anclaje a hora Bogotá (UTC-5)', () => {
  it('bogotaYmd usa el día calendario colombiano, no el UTC', () => {
    // 2026-09-01T02:00Z = 31 de agosto, 21:00 en Bogotá. Un corte "del 31"
    // calculado en UTC se habría corrido de día justo acá.
    expect(bogotaYmd(new Date('2026-09-01T02:00:00.000Z'))).toBe('2026-08-31');
    // 2026-08-31T05:00Z = medianoche exacta en Bogotá → ya es 31.
    expect(bogotaYmd(new Date('2026-08-31T05:00:00.000Z'))).toBe('2026-08-31');
    // Un minuto antes todavía es 30.
    expect(bogotaYmd(new Date('2026-08-31T04:59:00.000Z'))).toBe('2026-08-30');
  });

  it('el día Bogotá empieza a las 05:00 UTC y termina 24h después', () => {
    expect(bogotaDayStartUtc('2026-08-15').toISOString()).toBe(
      '2026-08-15T05:00:00.000Z',
    );
    expect(bogotaDayEndUtc('2026-08-15').toISOString()).toBe(
      '2026-08-16T05:00:00.000Z',
    );
  });

  it('las fechas de lote se guardan al mediodía de Bogotá', () => {
    expect(bogotaNoonUtc('2026-08-15').toISOString()).toBe(
      '2026-08-15T17:00:00.000Z',
    );
    // Y releída en Bogotá sigue siendo el mismo día (no se corre).
    expect(bogotaYmd(bogotaNoonUtc('2026-08-15'))).toBe('2026-08-15');
  });

  it('una comisión liberada el 16 en Bogotá queda FUERA del día 15', () => {
    // availableAt = 16 de agosto 00:30 Bogotá = 05:30 UTC.
    const liberada16 = new Date('2026-08-16T05:30:00.000Z');
    expect(liberada16.getTime() < bogotaDayEndUtc('2026-08-15').getTime()).toBe(
      false,
    );
    // …y la del 15 a las 23:00 Bogotá (04:00 UTC del 16) sí entra.
    const liberada15 = new Date('2026-08-16T04:00:00.000Z');
    expect(liberada15.getTime() < bogotaDayEndUtc('2026-08-15').getTime()).toBe(
      true,
    );
  });
});

describe('cutoffCode', () => {
  it('mantiene el formato existente CORTE-YYYY-MM-DD', () => {
    expect(cutoffCode('2026-06-30')).toBe('CORTE-2026-06-30');
    expect(cutoffCode('2026-07-15')).toBe('CORTE-2026-07-15');
    expect(cutoffCode('2026-07-31')).toBe('CORTE-2026-07-31');
  });

  it('rechaza fechas mal formadas', () => {
    expect(() => cutoffCode('2026-7-1')).toThrow();
    expect(() => cutoffCode('30/06/2026')).toThrow();
  });
});
