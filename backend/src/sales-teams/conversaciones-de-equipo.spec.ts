import { describe, expect, it } from 'vitest';
import { escaparLike, normalizarBandeja, vistaPrevia } from './conversaciones-de-equipo';

describe('normalizarBandeja', () => {
  it('sin nada: todos, sin búsqueda, primera página', () => {
    expect(normalizarBandeja({})).toEqual({ filtro: 'todos', texto: '', patron: '', digitos: '', pagina: 1 });
  });

  it('solo reconoce «no_leidos»; cualquier otro filtro es «todos»', () => {
    expect(normalizarBandeja({ filtro: 'no_leidos' }).filtro).toBe('no_leidos');
    expect(normalizarBandeja({ filtro: 'unread' }).filtro).toBe('todos');
  });

  it('los dígitos cuentan desde 4, y se quedan con los últimos 10', () => {
    expect(normalizarBandeja({ q: '300' }).digitos).toBe('');
    expect(normalizarBandeja({ q: '+57 300 111 2233' }).digitos).toBe('3001112233');
    expect(normalizarBandeja({ q: 'Ana' }).digitos).toBe('');
  });

  it('la página se recorta a un número razonable', () => {
    expect(normalizarBandeja({ pagina: '0' }).pagina).toBe(1);
    expect(normalizarBandeja({ pagina: 'abc' }).pagina).toBe(1);
    expect(normalizarBandeja({ pagina: '3' }).pagina).toBe(3);
    expect(normalizarBandeja({ pagina: 99999 }).pagina).toBe(1000);
  });

  it('la búsqueda llega recortada y con los comodines escapados', () => {
    const f = normalizarBandeja({ q: '  50% off_ya  ' });
    expect(f.texto).toBe('50% off_ya');
    expect(f.patron).toBe('50\\% off\\_ya');
  });
});

describe('escaparLike', () => {
  it('escapa %, _ y la propia barra', () => {
    expect(escaparLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });
});

describe('vistaPrevia', () => {
  it('pone el mensaje en una línea', () => {
    expect(vistaPrevia('hola\n\n  ¿cómo   vas?')).toBe('hola ¿cómo vas?');
  });

  it('recorta lo largo con puntos suspensivos', () => {
    const v = vistaPrevia('x'.repeat(200), 10);
    expect(v).toHaveLength(10);
    expect(v.endsWith('…')).toBe(true);
  });

  it('sin cuerpo, vacío', () => {
    expect(vistaPrevia(null)).toBe('');
  });
});
