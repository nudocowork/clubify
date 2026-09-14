import { describe, it, expect } from 'vitest';
import {
  estadoDeConfirmacion,
  grupoDeCita,
  minutosHasta,
  ordenarCola,
  sugerirCloser,
  VENTANA_1H_CIERRA,
  VENTANA_30MIN_CIERRA,
} from './banco-de-equipo.service';

/**
 * El «Banco» del equipo: las reglas que deciden qué ve quien reparte las citas.
 *
 * Son las de TeamClubify (`lib/closers.ts` y `getStefanyBank`), y se prueban
 * contra el módulo REAL: si alguien mueve una ventana o el orden de la cola, esto
 * se pone en rojo en vez de enseñarle a la coordinadora una cola equivocada.
 */

const cita = (over: Partial<{ status: string; conf1h: boolean; conf30min: boolean; confirmedAt: Date | null }> = {}) => ({
  status: 'PENDIENTE',
  conf1h: false,
  conf30min: false,
  confirmedAt: null as Date | null,
  ...over,
});

describe('en qué pestaña cae una cita', () => {
  it('pendiente sin closer → por asignar', () => {
    expect(grupoDeCita({ status: 'PENDIENTE', hostUserId: null })).toBe('por_asignar');
  });
  it('pendiente con closer → por confirmar', () => {
    expect(grupoDeCita({ status: 'PENDIENTE', hostUserId: 'u1' })).toBe('por_confirmar');
  });
  it('no asistió y cancelada tienen su pestaña', () => {
    expect(grupoDeCita({ status: 'NO_ASISTIO', hostUserId: 'u1' })).toBe('no_show');
    expect(grupoDeCita({ status: 'CANCELADA', hostUserId: null })).toBe('canceladas');
  });
  it('confirmada y realizada SALEN del banco: ya no hay nada que resolver', () => {
    expect(grupoDeCita({ status: 'CONFIRMADA', hostUserId: 'u1' })).toBeNull();
    expect(grupoDeCita({ status: 'REALIZADA', hostUserId: 'u1' })).toBeNull();
  });
});

describe('el semáforo de confirmación', () => {
  it('con tiempo de sobra, las dos ventanas están pendientes y no se persigue', () => {
    const e = estadoDeConfirmacion(cita(), 120);
    expect(e).toEqual({ h1: 'pendiente', m30: 'pendiente', hayQuePerseguir: false });
  });

  it('pasada la ventana de 1 h sin confirmar, esa vence; la de 30 min sigue abierta', () => {
    const e = estadoDeConfirmacion(cita(), VENTANA_1H_CIERRA);
    expect(e.h1).toBe('vencida');
    expect(e.m30).toBe('pendiente');
    expect(e.hayQuePerseguir).toBe(false);
  });

  it('vencidas LAS DOS → hay que perseguir', () => {
    const e = estadoDeConfirmacion(cita(), VENTANA_30MIN_CIERRA);
    expect(e).toEqual({ h1: 'vencida', m30: 'vencida', hayQuePerseguir: true });
  });

  it('una confirmación a mano cuenta como las dos', () => {
    const e = estadoDeConfirmacion(cita({ confirmedAt: new Date() }), 5);
    expect(e).toEqual({ h1: 'confirmada', m30: 'confirmada', hayQuePerseguir: false });
  });

  it('llegar tarde no es no venir: a los 10 min de empezada todavía se persigue', () => {
    expect(estadoDeConfirmacion(cita(), -10).hayQuePerseguir).toBe(true);
  });

  it('pasados 15 min de empezada ya no se persigue', () => {
    expect(estadoDeConfirmacion(cita(), -15).hayQuePerseguir).toBe(false);
  });

  it('una cita cerrada no se persigue nunca', () => {
    expect(estadoDeConfirmacion(cita({ status: 'CANCELADA' }), 5).hayQuePerseguir).toBe(false);
    expect(estadoDeConfirmacion(cita({ status: 'NO_ASISTIO' }), -5).hayQuePerseguir).toBe(false);
  });
});

describe('el closer sugerido', () => {
  it('es el menos cargado HOY', () => {
    expect(
      sugerirCloser([
        { id: 'ana', hoy: 3, semana: 5 },
        { id: 'luis', hoy: 1, semana: 9 },
      ]),
    ).toBe('luis');
  });
  it('a igualdad hoy, el menos cargado en la semana', () => {
    expect(
      sugerirCloser([
        { id: 'ana', hoy: 2, semana: 8 },
        { id: 'luis', hoy: 2, semana: 4 },
      ]),
    ).toBe('luis');
  });
  it('sin closers no se inventa ninguno', () => {
    expect(sugerirCloser([])).toBeNull();
  });
});

describe('el orden de la cola', () => {
  const t = (hhmm: string) => new Date(`2026-09-15T${hhmm}:00-05:00`);
  it('por hora, y a la misma hora primero la que tiene más confirmaciones', () => {
    const cola = ordenarCola([
      { id: 'b', startAt: t('10:00'), conf1h: false, conf30min: false },
      { id: 'c', startAt: t('09:00'), conf1h: false, conf30min: false },
      { id: 'a', startAt: t('10:00'), conf1h: true, conf30min: true },
    ]);
    expect(cola.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('minutos hasta la cita', () => {
  it('positivo si falta, negativo si ya pasó', () => {
    const ahora = new Date('2026-09-15T10:00:00Z');
    expect(minutosHasta(new Date('2026-09-15T10:30:00Z'), ahora)).toBe(30);
    expect(minutosHasta(new Date('2026-09-15T09:50:00Z'), ahora)).toBe(-10);
  });
});
