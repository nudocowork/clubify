import { describe, expect, it } from 'vitest';
import {
  EMBUDOS_INICIALES,
  ETAPAS_DE_EMBUDO_NUEVO,
  SIN_RESPONSABLE,
  datosDeEstado,
  esEstadoDeOportunidad,
  normalizarValor,
  ordenTrasSoltar,
  whereDeOportunidades,
} from './crm-de-equipo';

describe('esEstadoDeOportunidad', () => {
  it('acepta los cuatro estados y nada más', () => {
    for (const e of ['abierta', 'ganada', 'perdida', 'abandonada']) expect(esEstadoDeOportunidad(e)).toBe(true);
    expect(esEstadoDeOportunidad('won')).toBe(false);
    expect(esEstadoDeOportunidad(undefined)).toBe(false);
  });
});

describe('normalizarValor', () => {
  it('vacío es 0: una oportunidad sin valor todavía', () => {
    expect(normalizarValor('')).toBe(0);
    expect(normalizarValor(null)).toBe(0);
    expect(normalizarValor(undefined)).toBe(0);
  });

  it('redondea a dos decimales', () => {
    expect(normalizarValor(1500.555)).toBe(1500.56);
    expect(normalizarValor('300000')).toBe(300000);
  });

  it('lo que no es un número es un error, no un 0 silencioso', () => {
    expect(normalizarValor('1.500.000')).toEqual({ error: 'El valor no es un número' });
    expect(normalizarValor('abc')).toEqual({ error: 'El valor no es un número' });
  });

  it('rechaza negativos y lo que no cabe en DECIMAL(12,2)', () => {
    expect(normalizarValor(-1)).toEqual({ error: 'El valor no puede ser negativo' });
    expect(normalizarValor(1e11)).toEqual({ error: 'El valor es demasiado grande' });
  });
});

describe('ordenTrasSoltar', () => {
  it('inserta en la posición pedida', () => {
    expect(ordenTrasSoltar(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('más allá del final la deja la última, y antes del principio la primera', () => {
    expect(ordenTrasSoltar(['a', 'b'], 'x', 99)).toEqual(['a', 'b', 'x']);
    expect(ordenTrasSoltar(['a', 'b'], 'x', -3)).toEqual(['x', 'a', 'b']);
  });

  it('dentro de la misma columna no la duplica', () => {
    expect(ordenTrasSoltar(['a', 'x', 'b'], 'x', 2)).toEqual(['a', 'b', 'x']);
  });
});

describe('datosDeEstado', () => {
  const ahora = new Date('2026-09-14T15:00:00Z');

  it('ganada sella wonAt y limpia lo de perdida', () => {
    expect(datosDeEstado('ganada', 'lo que sea', ahora)).toEqual({
      status: 'ganada',
      wonAt: ahora,
      lostAt: null,
      lostReason: null,
    });
  });

  it('perdida sella lostAt y guarda el motivo recortado', () => {
    expect(datosDeEstado('perdida', '  sin presupuesto ', ahora)).toEqual({
      status: 'perdida',
      wonAt: null,
      lostAt: ahora,
      lostReason: 'sin presupuesto',
    });
  });

  it('reabrir limpia fechas y motivo', () => {
    expect(datosDeEstado('abierta', 'viejo', ahora)).toEqual({
      status: 'abierta',
      wonAt: null,
      lostAt: null,
      lostReason: null,
    });
  });
});

describe('whereDeOportunidades', () => {
  it('siempre empieza por el equipo y el embudo', () => {
    const w = whereDeOportunidades('t1', 'e1', {}) as { AND: unknown[] };
    expect(w.AND.slice(0, 2)).toEqual([{ salesTeamId: 't1' }, { pipelineId: 'e1' }]);
    expect(w.AND).toHaveLength(2);
  });

  it('un estado desconocido no filtra (en vez de dejar el tablero vacío)', () => {
    const w = whereDeOportunidades('t1', 'e1', { estado: 'won' }) as { AND: unknown[] };
    expect(w.AND).toHaveLength(2);
  });

  it('«sin responsable» busca las que no tienen', () => {
    const w = whereDeOportunidades('t1', 'e1', { responsable: SIN_RESPONSABLE }) as { AND: unknown[] };
    expect(w.AND).toContainEqual({ assignedUserId: null });
  });

  it('la búsqueda mira el nombre de la oportunidad y el del contacto', () => {
    const w = whereDeOportunidades('t1', 'e1', { q: ' Luna ' }) as { AND: Array<{ OR?: unknown[] }> };
    expect(w.AND[2].OR).toContainEqual({ name: { contains: 'Luna', mode: 'insensitive' } });
    expect(w.AND[2].OR).toContainEqual({ lead: { name: { contains: 'Luna', mode: 'insensitive' } } });
  });
});

describe('embudos iniciales', () => {
  it('todos traen etapas y colores en hex', () => {
    for (const e of [...EMBUDOS_INICIALES, { nombre: 'nuevo', etapas: ETAPAS_DE_EMBUDO_NUEVO }]) {
      expect(e.etapas.length).toBeGreaterThan(0);
      for (const s of e.etapas) expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
