import { describe, it, expect } from 'vitest';
import {
  mesContable,
  limitesDelMes,
  limitesDelPeriodo,
  mesAtras,
  mesesDelPeriodo,
  nombreDelPeriodo,
  periodoAnterior,
} from './periodo-contable';

describe('mesContable', () => {
  it('cuenta la venta de las 8 de la noche del último día en SU mes, no en el siguiente', () => {
    // 31/08/2026 20:00 Bogotá = 01:00 UTC del 01/09. En UTC saldría "2026-09".
    expect(mesContable(new Date('2026-09-01T01:00:00.000Z'))).toBe('2026-08');
  });

  it('la medianoche de Bogotá ya es del mes nuevo', () => {
    // 01/09/2026 00:00 Bogotá = 05:00 UTC.
    expect(mesContable(new Date('2026-09-01T05:00:00.000Z'))).toBe('2026-09');
  });
});

describe('limitesDelMes', () => {
  it('abre el mes a la medianoche de Bogotá', () => {
    expect(limitesDelMes('2026-09')!.from.toISOString()).toBe(
      '2026-09-01T05:00:00.000Z',
    );
  });

  it('lo cierra en el último instante del último día, en Bogotá', () => {
    // 30/09/2026 23:59:59.999 Bogotá = 04:59:59.999 UTC del 01/10.
    expect(limitesDelMes('2026-09')!.to.toISOString()).toBe(
      '2026-10-01T04:59:59.999Z',
    );
  });

  it('resuelve febrero bisiesto', () => {
    expect(limitesDelMes('2028-02')!.to.toISOString()).toBe(
      '2028-03-01T04:59:59.999Z',
    );
  });

  it('los bordes no dejan huecos ni solapes entre meses seguidos', () => {
    const agosto = limitesDelMes('2026-08')!;
    const septiembre = limitesDelMes('2026-09')!;
    expect(septiembre.from.getTime() - agosto.to.getTime()).toBe(1);
  });

  it('un instante cae dentro de los límites del mes que le asigna mesContable', () => {
    const venta = new Date('2026-09-01T01:00:00.000Z'); // 31/08 20:00 Bogotá
    const b = limitesDelMes(mesContable(venta))!;
    expect(venta >= b.from && venta <= b.to).toBe(true);
  });

  it('rechaza lo que no es un período', () => {
    expect(limitesDelMes('septiembre')).toBeNull();
    expect(limitesDelMes('2026-13')).toBeNull();
    expect(limitesDelMes('2026-9')).toBeNull();
  });
});

describe('mesAtras', () => {
  it('cruza el año hacia atrás', () => {
    expect(mesAtras('2026-01', 1)).toBe('2025-12');
    expect(mesAtras('2026-01', 13)).toBe('2024-12');
  });

  it('con 0 devuelve el mismo mes', () => {
    expect(mesAtras('2026-09', 0)).toBe('2026-09');
  });
});

describe('limitesDelPeriodo', () => {
  it('el mes coincide con limitesDelMes', () => {
    expect(limitesDelPeriodo('2026-09')).toEqual(limitesDelMes('2026-09'));
  });

  it('el trimestre abre con su primer mes y cierra con el tercero', () => {
    const t3 = limitesDelPeriodo('2026-T3')!;
    expect(t3.from!.toISOString()).toBe(limitesDelMes('2026-07')!.from.toISOString());
    expect(t3.to!.toISOString()).toBe(limitesDelMes('2026-09')!.to.toISOString());
  });

  it('el año va de enero a diciembre, en Bogotá', () => {
    const a = limitesDelPeriodo('2026')!;
    expect(a.from!.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(a.to!.toISOString()).toBe('2027-01-01T04:59:59.999Z');
  });

  it('"todo" y el vacío no ponen límites', () => {
    expect(limitesDelPeriodo('todo')).toEqual({});
    expect(limitesDelPeriodo('')).toEqual({});
    expect(limitesDelPeriodo(undefined)).toEqual({});
  });

  it('los cuatro trimestres cubren el año sin huecos ni solapes', () => {
    const anio = limitesDelPeriodo('2026')!;
    const ts = ['2026-T1', '2026-T2', '2026-T3', '2026-T4'].map(
      (x) => limitesDelPeriodo(x)!,
    );
    expect(ts[0].from!.getTime()).toBe(anio.from!.getTime());
    expect(ts[3].to!.getTime()).toBe(anio.to!.getTime());
    for (let i = 1; i < 4; i++) {
      expect(ts[i].from!.getTime() - ts[i - 1].to!.getTime()).toBe(1);
    }
  });

  it('devuelve null si no se entiende, para que quien llama decida', () => {
    expect(limitesDelPeriodo('2026-T5')).toBeNull();
    expect(limitesDelPeriodo('el mes pasado')).toBeNull();
  });

  // El rango de días lo pidió Javier (2026-09-29): «del 1 de septiembre al
  // 30 de noviembre», sin partirlo en meses.
  it('un rango de días abre el primero y cierra el último, en Bogotá', () => {
    const r = limitesDelPeriodo('2026-09-01..2026-11-30')!;
    expect(r.from!.toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(r.to!.toISOString()).toBe('2026-12-01T04:59:59.999Z');
  });

  it('un rango de un solo día es ese día entero', () => {
    const r = limitesDelPeriodo('2026-09-16..2026-09-16')!;
    expect(r.from!.toISOString()).toBe('2026-09-16T05:00:00.000Z');
    expect(r.to!.toISOString()).toBe('2026-09-17T04:59:59.999Z');
  });

  it('un rango al revés o con un día que no existe es null, no un período vacío', () => {
    // Al revés devolvería from > to: TODAS las consultas darían cero y el
    // panel parecería un mes sin movimiento en vez de un filtro mal puesto.
    expect(limitesDelPeriodo('2026-11-30..2026-09-01')).toBeNull();
    expect(limitesDelPeriodo('2026-02-31..2026-03-05')).toBeNull();
  });
});

describe('nombreDelPeriodo', () => {
  it('nombra mes, trimestre, año y el histórico', () => {
    expect(nombreDelPeriodo('2026-09')).toBe('septiembre de 2026');
    expect(nombreDelPeriodo('2026-T3')).toBe('3º trimestre de 2026');
    expect(nombreDelPeriodo('2026')).toBe('año 2026');
    expect(nombreDelPeriodo('todo')).toBe('Todo el histórico');
  });

  it('nombra un rango como se dice, con el año una sola vez si es el mismo', () => {
    expect(nombreDelPeriodo('2026-09-01..2026-11-30')).toBe(
      'del 1 de septiembre al 30 de noviembre de 2026',
    );
    expect(nombreDelPeriodo('2026-12-15..2027-01-10')).toBe(
      'del 15 de diciembre de 2026 al 10 de enero de 2027',
    );
  });
});

describe('periodoAnterior', () => {
  it('compara mes contra mes, trimestre contra trimestre, año contra año', () => {
    expect(periodoAnterior('2026-01')).toBe('2025-12');
    expect(periodoAnterior('2026-T1')).toBe('2025-T4');
    expect(periodoAnterior('2026')).toBe('2025');
  });

  it('el histórico no tiene con qué compararse', () => {
    expect(periodoAnterior('todo')).toBeNull();
  });
});

describe('mesesDelPeriodo', () => {
  it('un mes trae los seis que terminan en él', () => {
    expect(mesesDelPeriodo('2026-09')).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  it('un trimestre trae exactamente sus tres meses', () => {
    expect(mesesDelPeriodo('2026-T3')).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('un año trae sus doce', () => {
    const m = mesesDelPeriodo('2026');
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2026-01');
    expect(m[11]).toBe('2026-12');
  });

  it('el histórico trae los últimos doce meses', () => {
    const m = mesesDelPeriodo('todo', new Date('2026-09-15T12:00:00Z'));
    expect(m).toHaveLength(12);
    expect(m[11]).toBe('2026-09');
    expect(m[0]).toBe('2025-10');
  });

  it('un rango de días se dibuja por los meses que toca', () => {
    expect(mesesDelPeriodo('2026-09-15..2026-11-02')).toEqual([
      '2026-09', '2026-10', '2026-11',
    ]);
  });

  it('un rango no tiene «período anterior» comparable, como el histórico', () => {
    expect(periodoAnterior('2026-09-01..2026-11-30')).toBeNull();
  });
});
