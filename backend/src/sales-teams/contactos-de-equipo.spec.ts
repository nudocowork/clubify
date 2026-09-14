import { describe, it, expect } from 'vitest';
import {
  normalizarFiltros,
  SIN_ETIQUETA,
  whereDeContactos,
} from './contactos-de-equipo.service';

/**
 * «Contactos» del equipo: las reglas que deciden qué se consulta.
 *
 * Se prueban contra el módulo REAL. El `where` es lo que separa un equipo de
 * otro en cada filtro, y la limpieza de filtros es lo que impide guardar basura
 * en una lista guardada.
 */

const partes = (w: any) => w.AND as any[];

describe('el where de los contactos', () => {
  it('sin filtros, solo el equipo', () => {
    expect(whereDeContactos('t1', {})).toEqual({ AND: [{ salesTeamId: 't1' }] });
  });

  it('el equipo va SIEMPRE primero, filtre lo que filtre', () => {
    const w = whereDeContactos('t1', { q: 'ana', etiqueta: 'vip', columna: 's1', origen: 'Instagram' });
    expect(partes(w)[0]).toEqual({ salesTeamId: 't1' });
  });

  it('buscar un nombre NO busca por teléfono: sin dígitos casaría con todos', () => {
    const w = whereDeContactos('t1', { q: 'Ana' });
    const o = partes(w)[1].OR;
    expect(o.some((c: any) => 'phoneKey' in c || 'phone' in c)).toBe(false);
    expect(o).toContainEqual({ name: { contains: 'Ana', mode: 'insensitive' } });
  });

  it('buscar un teléfono busca en la clave de dígitos, no en el texto guardado', () => {
    // `phone` guarda «+57 300 111 2233» con espacios: buscar ahí «57300111» no
    // encontraba a nadie. La prueba anterior fijaba justo ese fallo.
    const w = whereDeContactos('t1', { q: '+57 300 111' });
    const o = partes(w)[1].OR;
    expect(o).toContainEqual({ phoneKey: { contains: '57300111' } });
    expect(o.some((c: any) => 'phone' in c)).toBe(false);
  });

  it('un número largo busca por sus últimos 10 dígitos, como la clave', () => {
    const w = whereDeContactos('t1', { q: '+57 300 111 2233' });
    expect(partes(w)[1].OR).toContainEqual({ phoneKey: { contains: '3001112233' } });
  });

  it('«sin etiqueta» pide la lista vacía, no una etiqueta con ese nombre', () => {
    expect(partes(whereDeContactos('t1', { etiqueta: SIN_ETIQUETA }))).toContainEqual({ tags: { isEmpty: true } });
  });

  it('una etiqueta, una columna y un origen se suman', () => {
    const w = partes(whereDeContactos('t1', { etiqueta: 'vip', columna: 's1', origen: 'Instagram' }));
    expect(w).toContainEqual({ tags: { has: 'vip' } });
    expect(w).toContainEqual({ stageId: 's1' });
    expect(w).toContainEqual({ source: 'Instagram' });
  });
});

describe('limpiar los filtros de una lista guardada', () => {
  it('solo las cuatro claves conocidas, recortadas', () => {
    expect(
      normalizarFiltros({ q: '  ana  ', etiqueta: 'vip', salesTeamId: 'OTRO', where: { id: 'x' } }),
    ).toEqual({ q: 'ana', etiqueta: 'vip' });
  });

  it('lo que no es texto se descarta', () => {
    expect(normalizarFiltros({ q: 42, etiqueta: ['vip'], columna: null })).toEqual({});
  });

  it('una lista «sin filtros» es un objeto vacío, no cuatro undefined', () => {
    expect(normalizarFiltros({})).toEqual({});
    expect(Object.keys(normalizarFiltros({ q: '   ' }))).toHaveLength(0);
  });

  it('basura entera no rompe nada', () => {
    expect(normalizarFiltros(null)).toEqual({});
    expect(normalizarFiltros('hola')).toEqual({});
  });

  it('un texto larguísimo se corta', () => {
    expect(normalizarFiltros({ q: 'x'.repeat(500) }).q).toHaveLength(120);
  });
});
