import { describe, expect, it } from 'vitest';
import {
  MAX_ACCION,
  estaVencida,
  normalizarAccion,
  normalizarFecha,
  normalizarVista,
  whereDeTareas,
} from './tareas-de-equipo';

describe('normalizarVista', () => {
  it('reconoce las cinco vistas y cae en «pendientes» con cualquier otra cosa', () => {
    for (const v of ['pendientes', 'vencidas', 'hoy', 'mias', 'completadas']) expect(normalizarVista(v)).toBe(v);
    expect(normalizarVista('open')).toBe('pendientes');
    expect(normalizarVista(undefined)).toBe('pendientes');
  });
});

describe('normalizarFecha', () => {
  it('vacía es null', () => {
    expect(normalizarFecha('')).toBeNull();
    expect(normalizarFecha(null)).toBeNull();
    expect(normalizarFecha(undefined)).toBeNull();
  });

  it('acepta un día que existe', () => {
    expect(normalizarFecha('2026-09-14')).toBe('2026-09-14');
    expect(normalizarFecha('2028-02-29')).toBe('2028-02-29');
  });

  it('rechaza la forma equivocada y los días que no existen', () => {
    expect(normalizarFecha('14/09/2026')).toEqual({ error: 'La fecha no es válida' });
    expect(normalizarFecha('2026-02-31')).toEqual({ error: 'La fecha no es válida' });
    expect(normalizarFecha('2027-02-29')).toEqual({ error: 'La fecha no es válida' });
  });
});

describe('normalizarAccion', () => {
  it('limpia espacios', () => {
    expect(normalizarAccion('  Llamar   al  cliente ')).toBe('Llamar al cliente');
  });

  it('vacía o larga es un error', () => {
    expect(normalizarAccion('   ')).toEqual({ error: 'Escribe la acción' });
    expect(normalizarAccion('x'.repeat(MAX_ACCION + 1))).toHaveProperty('error');
  });
});

describe('estaVencida', () => {
  const hoy = '2026-09-14';
  it('abierta con fecha pasada: vencida', () => {
    expect(estaVencida({ done: false, dueDate: '2026-09-13' }, hoy)).toBe(true);
  });
  it('hoy, sin fecha o hecha: no', () => {
    expect(estaVencida({ done: false, dueDate: hoy }, hoy)).toBe(false);
    expect(estaVencida({ done: false, dueDate: null }, hoy)).toBe(false);
    expect(estaVencida({ done: true, dueDate: '2026-01-01' }, hoy)).toBe(false);
  });
});

describe('whereDeTareas', () => {
  const hoy = '2026-09-14';
  it('siempre empieza por el equipo; completadas mira las hechas', () => {
    expect(whereDeTareas('t1', 'pendientes', hoy, 'u1')).toEqual({ salesTeamId: 't1', done: false });
    expect(whereDeTareas('t1', 'completadas', hoy, 'u1')).toEqual({ salesTeamId: 't1', done: true });
  });
  it('vencidas, hoy y mías', () => {
    expect(whereDeTareas('t1', 'vencidas', hoy, 'u1')).toEqual({ salesTeamId: 't1', done: false, dueDate: { lt: hoy } });
    expect(whereDeTareas('t1', 'hoy', hoy, 'u1')).toEqual({ salesTeamId: 't1', done: false, dueDate: hoy });
    expect(whereDeTareas('t1', 'mias', hoy, 'u1')).toEqual({ salesTeamId: 't1', done: false, assignedUserId: 'u1' });
  });
});
