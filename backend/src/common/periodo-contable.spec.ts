import { describe, it, expect } from 'vitest';
import {
  mesContable,
  limitesDelMes,
  mesAtras,
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
