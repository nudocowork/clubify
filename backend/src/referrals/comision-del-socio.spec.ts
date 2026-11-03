import { describe, expect, it } from 'vitest';
import { corteDelMes, mesesDelSocio } from './comision-del-socio.service';

describe('comisión del socio', () => {
  it('se paga en el corte del ÚLTIMO día del mes, nunca en el del 15', () => {
    expect(corteDelMes('2026-10')).toBe('2026-10-31');
    expect(corteDelMes('2026-11')).toBe('2026-11-30');
    expect(corteDelMes('2027-02')).toBe('2027-02-28');
  });

  it('una por mes desde octubre de 2026 hasta el mes en curso, cruzando el año', () => {
    expect(mesesDelSocio('2026-10', '2027-01')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(mesesDelSocio('2026-10', '2026-09')).toEqual([]);
  });
});
