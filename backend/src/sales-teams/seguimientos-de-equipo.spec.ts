import { describe, it, expect } from 'vitest';
import {
  fechaDelReintento,
  grupoDeSeguimiento,
  pasosEIntentos,
  validarResultado,
} from './seguimientos-de-equipo';

/**
 * «Seguimientos» del equipo: grupos, paso e intento, y lo que pide cada
 * resultado. Reglas de TeamClubify, probadas contra el módulo REAL.
 */

const BOGOTA = 'America/Bogota';
const HOY = '2026-09-15';

describe('en qué grupo cae un seguimiento', () => {
  it('de un día anterior → vencidos', () => {
    expect(grupoDeSeguimiento(new Date('2026-09-14T20:00:00Z'), HOY, BOGOTA)).toBe('vencidos');
  });
  it('de hoy a primera hora sigue siendo «para hoy», no vencido', () => {
    // 08:00 de Bogotá del mismo día.
    expect(grupoDeSeguimiento(new Date('2026-09-15T13:00:00Z'), HOY, BOGOTA)).toBe('hoy');
  });
  it('se mira el día de BOGOTÁ: las 23:00 de Bogotá ya son el día siguiente en UTC', () => {
    // 2026-09-16 03:00 UTC = 2026-09-15 22:00 en Bogotá.
    expect(grupoDeSeguimiento(new Date('2026-09-16T03:00:00Z'), HOY, BOGOTA)).toBe('hoy');
  });
  it('de mañana en adelante → programados', () => {
    expect(grupoDeSeguimiento(new Date('2026-09-16T15:00:00Z'), HOY, BOGOTA)).toBe('programados');
  });
});

describe('paso e intento', () => {
  const t = (d: number) => new Date(`2026-09-${String(d).padStart(2, '0')}T12:00:00Z`);

  it('el paso es la posición por creación', () => {
    const m = pasosEIntentos([
      { id: 'b', createdAt: t(3), outcome: null },
      { id: 'a', createdAt: t(1), outcome: 'continuar' },
    ]);
    expect(m.get('a')?.paso).toBe(1);
    expect(m.get('b')?.paso).toBe(2);
  });

  it('el intento cuenta los «no respondió» seguidos justo antes', () => {
    const m = pasosEIntentos([
      { id: '1', createdAt: t(1), outcome: 'no_respondio' },
      { id: '2', createdAt: t(2), outcome: 'no_respondio' },
      { id: '3', createdAt: t(3), outcome: null },
    ]);
    expect(m.get('1')?.intento).toBe(1);
    expect(m.get('2')?.intento).toBe(2);
    expect(m.get('3')?.intento).toBe(3);
  });

  it('una respuesta en medio reinicia el conteo', () => {
    const m = pasosEIntentos([
      { id: '1', createdAt: t(1), outcome: 'no_respondio' },
      { id: '2', createdAt: t(2), outcome: 'continuar' },
      { id: '3', createdAt: t(3), outcome: null },
    ]);
    expect(m.get('3')?.intento).toBe(1);
  });
});

describe('lo que pide cada resultado', () => {
  const ahora = new Date('2026-09-15T15:00:00Z');
  const manana = '2026-09-16T15:00:00Z';

  it('un resultado inventado se rechaza', () => {
    expect(validarResultado({ outcome: 'ganó' }, ahora)).toEqual({ error: 'Resultado no válido' });
  });

  it('continuar y más tiempo exigen fecha: sin ella el lead se cae de la lista', () => {
    expect('error' in validarResultado({ outcome: 'continuar' }, ahora)).toBe(true);
    expect('error' in validarResultado({ outcome: 'mas_tiempo' }, ahora)).toBe(true);
    expect('error' in validarResultado({ outcome: 'continuar', proximaFecha: manana }, ahora)).toBe(false);
  });

  it('no respondió deja la fecha opcional', () => {
    expect(validarResultado({ outcome: 'no_respondio' }, ahora)).toMatchObject({ outcome: 'no_respondio', proximaFecha: null });
  });

  it('no calificado exige motivo', () => {
    expect('error' in validarResultado({ outcome: 'no_calificado' }, ahora)).toBe(true);
    expect(validarResultado({ outcome: 'no_calificado', motivo: ' Sin presupuesto ' }, ahora)).toMatchObject({
      motivo: 'Sin presupuesto',
    });
  });

  it('compró no pide nada', () => {
    expect(validarResultado({ outcome: 'compro' }, ahora)).toMatchObject({ outcome: 'compro' });
  });

  it('una fecha de antier se rechaza; «hoy» a medianoche se acepta', () => {
    expect('error' in validarResultado({ outcome: 'continuar', proximaFecha: '2026-09-13T12:00:00Z' }, ahora)).toBe(true);
    expect('error' in validarResultado({ outcome: 'continuar', proximaFecha: '2026-09-15T05:00:00Z' }, ahora)).toBe(false);
  });

  it('una fecha que no es fecha se rechaza', () => {
    expect(validarResultado({ outcome: 'continuar', proximaFecha: 'mañana' }, ahora)).toEqual({
      error: 'La fecha del próximo paso no es válida',
    });
  });
});

describe('fechaDelReintento', () => {
  // 09:00 en Bogotá (UTC-5, sin horario de verano) son las 14:00 UTC.
  it('el primer reintento (intento 2) va a los 3 días, a las 9:00 de Bogotá', () => {
    expect(fechaDelReintento(2, '2026-09-14', 'America/Bogota').toISOString()).toBe('2026-09-17T14:00:00.000Z');
  });

  it('el intento 3 va a los 7 días y cruza de mes sin correrse', () => {
    expect(fechaDelReintento(3, '2026-09-30', 'America/Bogota').toISOString()).toBe('2026-10-07T14:00:00.000Z');
  });

  it('del cuarto intento en adelante se repite el último escalón (14 días)', () => {
    expect(fechaDelReintento(4, '2026-09-14', 'America/Bogota').toISOString()).toBe('2026-09-28T14:00:00.000Z');
    expect(fechaDelReintento(9, '2026-09-14', 'America/Bogota').toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });
});
