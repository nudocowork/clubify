import { describe, it, expect } from 'vitest';
import {
  aNumero,
  adicionesDeProducto,
  modoDePrecioDeVariantes,
  variantesDeProducto,
} from './variantes-del-onboarding';

/**
 * La prueba que manda es la del precio: «34.900» es treinta y cuatro mil
 * novecientos en Colombia, no treinta y cuatro con nueve. Leerlo mal le cobra
 * al cliente mil veces menos —o, en modo DELTA, casi el doble.
 */

describe('aNumero', () => {
  it('«34.900» es treinta y cuatro mil novecientos, no 34,9', () => {
    expect(aNumero('34.900')).toBe(34900);
    expect(aNumero('1.250.000')).toBe(1250000);
  });

  it('con uno o dos decimales sí es decimal', () => {
    expect(aNumero('12,50')).toBe(12.5);
    expect(aNumero('12.5')).toBe(12.5);
  });

  it('aguanta símbolos y espacios', () => {
    expect(aNumero(' $ 8.000 ')).toBe(8000);
    expect(aNumero(8000)).toBe(8000);
  });

  it('lo que no es un número no lo inventa', () => {
    expect(aNumero('Consultar')).toBeNull();
    expect(aNumero('')).toBeNull();
    expect(aNumero(null)).toBeNull();
  });
});

describe('variantesDeProducto', () => {
  it('sin la clave devuelve null: no se toca lo del panel', () => {
    expect(variantesDeProducto({})).toBeNull();
  });

  it('la Bandeja Paisa con sus torres', () => {
    const r = variantesDeProducto({
      variants: [
        { groupName: 'Tamaño', name: 'Torre pequeña', price: '34.900' },
        { groupName: 'Tamaño', name: 'Torre personal', price: '44.900' },
      ],
    });
    expect(r).toEqual([
      {
        groupName: 'Tamaño',
        name: 'Torre pequeña',
        priceDelta: 34900,
        isDefault: false,
        position: 0,
      },
      {
        groupName: 'Tamaño',
        name: 'Torre personal',
        priceDelta: 44900,
        isDefault: false,
        position: 1,
      },
    ]);
  });

  // Hay presentaciones que valen lo mismo que el producto y el formulario las
  // deja en blanco. Descartarlas dejaría al cliente sin poder elegirlas.
  it('una variante sin precio vale lo mismo que el base, no se descarta', () => {
    const r = variantesDeProducto({ variants: [{ name: 'Normal' }] });
    expect(r).toHaveLength(1);
    expect(r![0].priceDelta).toBe(0);
  });

  it('sin nombre no es una variante', () => {
    expect(variantesDeProducto({ variants: [{ price: 100 }, null, 'x'] })).toEqual([]);
  });

  it('el grupo por defecto es Tamaño', () => {
    expect(variantesDeProducto({ variants: [{ name: 'Grande' }] })![0].groupName).toBe(
      'Tamaño',
    );
  });

  it('la posición sale del orden en que llegan', () => {
    const r = variantesDeProducto({
      variants: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    });
    expect(r!.map((v) => v.position)).toEqual([0, 1, 2]);
  });

  it('lista vacía = quitar las variantes, y eso NO es lo mismo que no tocarlas', () => {
    expect(variantesDeProducto({ variants: [] })).toEqual([]);
    expect(variantesDeProducto({})).toBeNull();
  });
});

describe('adicionesDeProducto', () => {
  it('recoge nombre, precio y tope', () => {
    expect(
      adicionesDeProducto({ extras: [{ name: 'Queso extra', price: '3.000', maxQty: 2 }] }),
    ).toEqual([{ name: 'Queso extra', price: 3000, maxQty: 2, isAvailable: true }]);
  });

  // Un tope de 0 sería una adición que no se puede elegir: aparece en la carta
  // y no deja añadirla.
  it('el tope nunca baja de 1', () => {
    expect(adicionesDeProducto({ extras: [{ name: 'X', maxQty: 0 }] })![0].maxQty).toBe(1);
    expect(adicionesDeProducto({ extras: [{ name: 'X' }] })![0].maxQty).toBe(1);
  });

  it('sin la clave no se toca nada', () => {
    expect(adicionesDeProducto({})).toBeNull();
  });
});

describe('modoDePrecioDeVariantes', () => {
  // El formulario pide el PRECIO FINAL de cada presentación. Tratarlo como
  // delta le sumaría el base encima y cobraría casi el doble.
  it('por defecto es ABSOLUTE, que es lo que manda el formulario', () => {
    expect(modoDePrecioDeVariantes({})).toBe('ABSOLUTE');
  });

  it('se puede pedir DELTA a propósito', () => {
    expect(modoDePrecioDeVariantes({ variantPriceMode: 'delta' })).toBe('DELTA');
    expect(modoDePrecioDeVariantes({ variantPriceMode: 'DELTA' })).toBe('DELTA');
  });

  it('un valor raro cae en ABSOLUTE, no rompe el sync', () => {
    expect(modoDePrecioDeVariantes({ variantPriceMode: 'lo que sea' })).toBe('ABSOLUTE');
  });
});
