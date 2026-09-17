import { describe, it, expect } from 'vitest';
import {
  componerEnlaces,
  normalizarEnlaces,
  MAX_ENLACES,
} from './enlaces-de-venta';

/**
 * Javier (2026-09-17): «hay que hacer la sincronización de los nuevos planes con
 * los influencers, vendedores, embajadores… enlazar el plan anual en 7 días free
 * con Clubify. Y que lo tengan también cada uno de los referidos en sus paneles,
 * con enlaces correspondientes». Además de los planes normales hay enlaces de
 * pago parcial y de pago con prueba de 7 días, uno por periodicidad.
 *
 * Hasta hoy solo cabían CUATRO enlaces fijos: cualquier oferta nueva se quedaba
 * fuera del panel del afiliado hasta que alguien tocara el código.
 */

const PLANES = {
  mensual: { price: 68, checkoutUrl: 'https://pay.hotmart.com/U1?off=5xge6zhd' },
  trimestral: { price: 150, checkoutUrl: 'https://pay.hotmart.com/U1?off=04u23bz7' },
  semestral: { price: 278, checkoutUrl: 'https://pay.hotmart.com/U1?off=f6g1gl5y' },
  anual: { price: 500, checkoutUrl: 'https://pay.hotmart.com/U1?off=f4weer6x' },
};

describe('la lista de enlaces que se configura a mano', () => {
  it('acepta el JSON del ajuste tal como se guarda', () => {
    const r = normalizarEnlaces(
      '[{"id":"anual-7dias","nombre":"Anual con 7 días gratis","tipo":"PRUEBA","periodicidad":"anual","precioUsd":500,"url":"https://pay.hotmart.com/U1?off=nuevo"}]',
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: 'anual-7dias',
      nombre: 'Anual con 7 días gratis',
      tipo: 'PRUEBA',
      periodicidad: 'ANUAL',
      precioUsd: 500,
      activo: true,
    });
  });

  it('descarta lo que no sirve: sin nombre, sin URL o con una URL que no es http', () => {
    const r = normalizarEnlaces([
      { nombre: '', url: 'https://pay.hotmart.com/U1' },
      { nombre: 'Sin enlace', url: '' },
      { nombre: 'Peligroso', url: 'javascript:alert(1)' },
      { nombre: 'Bueno', url: 'https://pay.hotmart.com/U1?off=x' },
    ]);
    expect(r.map((e) => e.nombre)).toEqual(['Bueno']);
  });

  it('dos enlaces con el mismo id no se pisan', () => {
    const r = normalizarEnlaces([
      { id: 'parcial', nombre: 'Pago parcial 1', url: 'https://pay.hotmart.com/U1?off=a' },
      { id: 'parcial', nombre: 'Pago parcial 2', url: 'https://pay.hotmart.com/U1?off=b' },
    ]);
    expect(r.map((e) => e.id)).toEqual(['parcial', 'parcial-2']);
  });

  it('un tipo que no existe cae a NORMAL, y la basura no rompe nada', () => {
    expect(normalizarEnlaces([{ nombre: 'X', url: 'https://a.co', tipo: 'LO_QUE_SEA' }])[0].tipo).toBe('NORMAL');
    expect(normalizarEnlaces('no es json')).toEqual([]);
    expect(normalizarEnlaces(null)).toEqual([]);
    expect(normalizarEnlaces({ nombre: 'X' })).toEqual([]);
  });

  it('quita el sck/src que venga pegado: ahí va el código del afiliado', () => {
    // Un enlace copiado de una campaña de Hotmart (?sck=instagram) dejaba todas
    // las ventas de los afiliados sin atribuir, en silencio.
    const r = normalizarEnlaces([
      { nombre: 'Anual 7 días', url: 'https://pay.hotmart.com/U1?off=abc&sck=instagram&src=otro&bid=9' },
    ]);
    expect(r[0].url).toBe('https://pay.hotmart.com/U1?off=abc&bid=9');
  });

  it('tiene tope: es una lista a mano, no un catálogo', () => {
    const muchos = Array.from({ length: MAX_ENLACES + 5 }, (_, i) => ({
      nombre: `E${i}`,
      url: `https://pay.hotmart.com/U1?off=${i}`,
    }));
    expect(normalizarEnlaces(muchos)).toHaveLength(MAX_ENLACES);
  });
});

describe('lo que ve quien comparte enlaces', () => {
  it('los 4 planes de siempre siguen primero, con su precio', () => {
    const r = componerEnlaces({ planes: PLANES });
    expect(r.map((e) => e.nombre)).toEqual(['Mensual', 'Trimestral', 'Semestral', 'Anual']);
    expect(r[3]).toMatchObject({ tipo: 'NORMAL', periodicidad: 'ANUAL', precioUsd: 500 });
  });

  it('el enlace de prueba entra con sus días', () => {
    const r = componerEnlaces({ planes: PLANES, urlDePrueba: 'https://pay.hotmart.com/U1?off=h9p7d1rh', diasDePrueba: 7 });
    expect(r.at(-1)).toMatchObject({ id: 'prueba', nombre: 'Prueba de 7 días', tipo: 'PRUEBA' });
  });

  it('los enlaces añadidos (pago parcial, prueba del anual) salen detrás', () => {
    const extras = normalizarEnlaces([
      { id: 'anual-7dias', nombre: 'Anual con 7 días gratis', tipo: 'PRUEBA', periodicidad: 'anual', url: 'https://pay.hotmart.com/U1?off=nuevo' },
      { id: 'parcial-anual', nombre: 'Anual en 2 pagos', tipo: 'PARCIAL', url: 'https://pay.hotmart.com/U1?off=parcial' },
    ]);
    const r = componerEnlaces({ planes: PLANES, extras });
    expect(r.map((e) => e.id).slice(-2)).toEqual(['anual-7dias', 'parcial-anual']);
  });

  it('un enlace apagado no se comparte', () => {
    const extras = normalizarEnlaces([
      { id: 'viejo', nombre: 'Oferta vieja', url: 'https://pay.hotmart.com/U1?off=viejo', activo: false },
    ]);
    expect(componerEnlaces({ planes: PLANES, extras }).map((e) => e.id)).not.toContain('viejo');
  });

  it('un plan sin URL configurada no sale (un botón que no lleva a ninguna parte)', () => {
    const r = componerEnlaces({ planes: { ...PLANES, semestral: { price: 278, checkoutUrl: null } } });
    expect(r.map((e) => e.periodicidad)).toEqual(['MENSUAL', 'TRIMESTRAL', 'ANUAL']);
  });

  it('un extra con el id de un plan no lo duplica', () => {
    const extras = normalizarEnlaces([{ id: 'plan-anual', nombre: 'Anual bis', url: 'https://pay.hotmart.com/U1?off=bis' }]);
    expect(componerEnlaces({ planes: PLANES, extras }).filter((e) => e.id === 'plan-anual')).toHaveLength(1);
  });
});
