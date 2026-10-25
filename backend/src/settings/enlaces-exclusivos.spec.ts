import { describe, it, expect } from 'vitest';
import { componerEnlaces, enlaceVisiblePara, normalizarCodigos, normalizarEnlaces } from './enlaces-de-venta';

const exclusivo = {
  id: 'impl-2',
  nombre: '(Implementación Estrategia 2) - 25$ Único pago',
  tipo: 'NORMAL' as const,
  periodicidad: 'MENSUAL',
  precioUsd: 25,
  url: 'https://pay.hotmart.com/X106312639E?off=ui48vhsp',
  activo: true,
  soloParaCodigos: ['QZ4ZYHDZ', 'TAFMPWK5'],
};

describe('enlaces de venta exclusivos de un afiliado', () => {
  it('el dueño del código lo ve; otro afiliado no', () => {
    const delDueno = componerEnlaces({ planes: {}, extras: [exclusivo], codigosDelQueMira: ['qz4zyhdz'] });
    const deOtro = componerEnlaces({ planes: {}, extras: [exclusivo], codigosDelQueMira: ['ABC123'] });
    expect(delDueno.map((e) => e.id)).toEqual(['impl-2']);
    expect(deOtro).toEqual([]);
  });

  it('la lista pública (sin sesión) nunca lo trae', () => {
    expect(componerEnlaces({ planes: {}, extras: [exclusivo] })).toEqual([]);
  });

  it('un enlace sin restricción lo ven todos', () => {
    expect(enlaceVisiblePara({}, [])).toBe(true);
    expect(enlaceVisiblePara({ soloParaCodigos: [] }, ['X'])).toBe(true);
  });

  it('guardar la lista desde Branding NO borra la restricción', () => {
    // Si se perdiera al normalizar, el pago único quedaría a la vista de todos.
    const [e] = normalizarEnlaces([{ ...exclusivo, soloParaCodigos: ' qz4zyhdz , TAFMPWK5,,' }]);
    expect(e.soloParaCodigos).toEqual(['QZ4ZYHDZ', 'TAFMPWK5']);
  });

  it('los códigos se limpian', () => {
    expect(normalizarCodigos('a1, a1; b-2  c_3 !!')).toEqual(['A1', 'B-2', 'C_3']);
    expect(normalizarCodigos(null)).toEqual([]);
  });
});
