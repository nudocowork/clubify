import { describe, it, expect } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Galería y horarios del aliado (spec §5/§28).
 *
 * El aliado es un negocio EXTERNO con su propio login, y lo que guarda acá se
 * pinta en la cartelera pública. Estos tests fijan que el servidor acote lo que
 * entra: sin esto, un PATCH podía dejar miles de entradas o un `javascript:`
 * que después sale en un href.
 */
const svc = Object.create(CuponeraService.prototype) as CuponeraService;
const fotos = (v: unknown) => (svc as any).normalizePhotos(v);
const horas = (v: unknown) => (svc as any).normalizeHours(v);

describe('normalizePhotos', () => {
  it('no toca la columna si el campo no vino', () => {
    expect(fotos(undefined)).toBeUndefined();
  });

  it('acepta http, https, rutas propias y data:image', () => {
    const r = fotos([
      'https://cdn.x/a.jpg', 'http://cdn.x/b.jpg', '/uploads/c.jpg', 'data:image/png;base64,AAA',
    ]);
    expect(r).toHaveLength(4);
  });

  it('descarta esquemas peligrosos', () => {
    expect(fotos(['javascript:alert(1)', 'https://ok.com/a.jpg'])).toEqual(['https://ok.com/a.jpg']);
  });

  it('descarta data: que no sea imagen', () => {
    expect(fotos(['data:text/html;base64,PHNjcmlwdD4='])).toEqual([]);
  });

  it('descarta vacíos y lo que no sea texto', () => {
    expect(fotos(['', '   ', 42, null, { u: 'x' }, 'https://ok.com/a.jpg'])).toEqual(['https://ok.com/a.jpg']);
  });

  it('tope de 8 fotos', () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `https://cdn.x/${i}.jpg`);
    expect(fotos(muchas)).toHaveLength(8);
  });

  it('descarta URLs absurdamente largas', () => {
    expect(fotos(['https://x.com/' + 'a'.repeat(3000)])).toEqual([]);
  });

  it('si mandan algo que no es lista, vacía la galería en vez de romper', () => {
    expect(fotos('https://cdn.x/a.jpg')).toEqual([]);
  });
});

describe('normalizeHours', () => {
  it('no toca la columna si el campo no vino', () => {
    expect(horas(undefined)).toBeUndefined();
  });

  it('guarda solo los siete días', () => {
    expect(horas({ lun: '8-18', dom: 'Cerrado', pepe: 'x', __proto__: 'y' }))
      .toEqual({ lun: '8-18', dom: 'Cerrado' });
  });

  it('deja texto libre: la realidad de un negocio no siempre encaja en un rango', () => {
    expect(horas({ mar: '8-12 y 14-19' })).toEqual({ mar: '8-12 y 14-19' });
  });

  it('recorta a 40 caracteres', () => {
    const r = horas({ lun: 'a'.repeat(200) });
    expect(r!.lun).toHaveLength(40);
  });

  it('descarta días vacíos y valores que no son texto', () => {
    expect(horas({ lun: '  ', mar: 42, mie: null, jue: '9-17' })).toEqual({ jue: '9-17' });
  });

  it('un array no es un horario', () => {
    expect(horas(['8-18'])).toEqual({});
  });
});
