import { describe, expect, it } from 'vitest';
import {
  codigosDeOfertasAdicionales,
  esOfertaAdicional,
  nombreDelServicio,
} from './servicio-adicional-hotmart';

describe('servicios adicionales de Hotmart', () => {
  it('el Paquete de Alianzas de ALTIERI no es un plan', () => {
    const codigos = codigosDeOfertasAdicionales(null);
    expect(esOfertaAdicional('ticqog5c', codigos)).toBe(true);
    expect(esOfertaAdicional('ESWD2IIR', codigos)).toBe(true);
  });

  it('los planes siguen siendo planes', () => {
    const codigos = codigosDeOfertasAdicionales(null);
    for (const plan of ['f4weer6x', '04u23bz7', 'vkfveas1', '5xge6zhd', 'shoro1ov', 'f6g1gl5y']) {
      expect(esOfertaAdicional(plan, codigos)).toBe(false);
    }
    expect(esOfertaAdicional(null, codigos)).toBe(false);
    expect(esOfertaAdicional('', codigos)).toBe(false);
  });

  it('el ajuste añade códigos sin quitar los de siempre', () => {
    expect(codigosDeOfertasAdicionales('["NUEVO1"]')).toEqual(
      expect.arrayContaining(['ticqog5c', 'eswd2iir', 'nuevo1']),
    );
    expect(codigosDeOfertasAdicionales('abc, def')).toEqual(
      expect.arrayContaining(['ticqog5c', 'abc', 'def']),
    );
  });

  it('se nombra con el plan de Hotmart', () => {
    expect(
      nombreDelServicio({ data: { subscription: { plan: { name: 'Paquete de Alianzas' } } } }),
    ).toBe('Paquete de Alianzas');
    expect(nombreDelServicio({})).toBe('Servicio adicional');
  });
});
