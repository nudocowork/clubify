import { describe, expect, it } from 'vitest';
import { cambiarDesde, leerHistorial, mesesEntre, montoDelMes, totalDelMes, GastoOperativo } from './gastos-operativos';

const vercel = (h: Record<string, number> = {}, extra: Partial<GastoOperativo> = {}): GastoOperativo => ({
  id: 'v', amountUsd: 150, periodicity: 'MENSUAL', active: true, historial: h, ...extra,
});

describe('gastos operativos', () => {
  it('cuenta en todos los meses desde mayo de 2026 y en ninguno antes', () => {
    expect(montoDelMes(vercel(), '2026-04')).toBe(0);
    expect(montoDelMes(vercel(), '2026-05')).toBe(150);
    expect(montoDelMes(vercel(), '2026-10')).toBe(150);
  });

  it('un cambio vale desde su mes hasta el siguiente cambio, sin tocar los anteriores', () => {
    const g = vercel({ '2026-12': 200, '2027-03': 180 });
    expect(montoDelMes(g, '2026-11')).toBe(150);
    expect(montoDelMes(g, '2026-12')).toBe(200);
    expect(montoDelMes(g, '2027-02')).toBe(200);
    expect(montoDelMes(g, '2027-03')).toBe(180);
  });

  it('no deja cambiar un mes que ya pasó', () => {
    expect(() => cambiarDesde(vercel(), '2026-10', 10, '2026-11')).toThrow(/pasados/);
    expect(cambiarDesde(vercel(), '2026-11', 10, '2026-11')).toEqual({ '2026-11': 10 });
  });

  it('pasa quincenal y anual a su valor mensual', () => {
    expect(montoDelMes(vercel({}, { periodicity: 'QUINCENAL', amountUsd: 20 }), '2026-06')).toBe(40);
    expect(montoDelMes(vercel({}, { periodicity: 'ANUAL', amountUsd: 120 }), '2026-06')).toBe(10);
  });

  it('un gasto inactivo no cuenta; los totales suman por mes', () => {
    const gastos = [vercel(), vercel({}, { id: 'r', amountUsd: 30 }), vercel({}, { id: 'x', active: false })];
    expect(totalDelMes(gastos, '2026-07')).toBe(180);
  });

  it('lee un historial dañado como vacío y descarta claves que no son meses', () => {
    expect(leerHistorial('no json')).toEqual({});
    expect(leerHistorial('{"2026-12": 40, "basura": 3, "2026-13": 1}')).toEqual({ '2026-12': 40 });
  });

  it('enumera meses cruzando el año', () => {
    expect(mesesEntre('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});
