import { describe, it, expect } from 'vitest';
import {
  FIN_POR_DEFECTO,
  franjaDeHora,
  franjasDelDia,
  horaEnZona,
  INICIO_POR_DEFECTO,
  semaforoDeCita,
} from './agenda-del-dia';

/**
 * La rejilla del día de la Agenda: franjas, celda de cada cita y semáforo.
 *
 * Las reglas son las de TeamClubify (`agendaSlots`, `appointmentColor`,
 * `isConfirmed`), probadas contra el módulo REAL.
 */

const BOGOTA = 'America/Bogota';

describe('la hora de una cita en Bogotá', () => {
  it('14:30 UTC son las 09:30 en Bogotá', () => {
    expect(horaEnZona(new Date('2026-09-15T14:30:00Z'), BOGOTA)).toBe('09:30');
  });
  it('medianoche sale 00:00, no 24:00', () => {
    expect(horaEnZona(new Date('2026-09-15T05:00:00Z'), BOGOTA)).toBe('00:00');
  });
});

describe('la franja en la que cae una cita', () => {
  it('una hora exacta se queda en su fila', () => {
    expect(franjaDeHora('10:00')).toBe('10:00');
    expect(franjaDeHora('10:30')).toBe('10:30');
  });
  it('una hora suelta cae en la fila de encima, no desaparece', () => {
    expect(franjaDeHora('10:45')).toBe('10:30');
    expect(franjaDeHora('10:15')).toBe('10:00');
  });
});

describe('las franjas del día', () => {
  it('sin horario, el rango de TeamClubify: 09:00 a 17:30', () => {
    const f = franjasDelDia([], []);
    expect(f[0]).toBe('09:00');
    expect(f[f.length - 1]).toBe('17:30');
    expect(f).toHaveLength((FIN_POR_DEFECTO - INICIO_POR_DEFECTO) / 30);
  });

  it('con horario, de la primera hora a la última del equipo', () => {
    const f = franjasDelDia(
      [
        { startMin: 8 * 60, endMin: 12 * 60 },
        { startMin: 14 * 60, endMin: 16 * 60 },
      ],
      [],
    );
    expect(f[0]).toBe('08:00');
    expect(f[f.length - 1]).toBe('15:30');
  });

  it('una cita fuera del horario estira la rejilla: esconderla es perderla', () => {
    const f = franjasDelDia([{ startMin: 8 * 60, endMin: 12 * 60 }], ['19:15']);
    expect(f).toContain('19:00');
    expect(f[f.length - 1]).toBe('19:00');
  });

  it('sin duplicados y en orden', () => {
    const f = franjasDelDia([], ['09:00', '09:10', '07:30']);
    expect(f[0]).toBe('07:30');
    expect(new Set(f).size).toBe(f.length);
  });

  it('una franja mal cargada (fin antes que inicio) no rompe el rango', () => {
    const f = franjasDelDia([{ startMin: 12 * 60, endMin: 8 * 60 }], []);
    expect(f[0]).toBe('09:00');
  });
});

describe('el semáforo de una cita', () => {
  const base = { status: 'PENDIENTE', conf1h: false, conf30min: false, confirmedAt: null };

  it('sin confirmar, gris', () => {
    expect(semaforoDeCita(base)).toBe('gris');
  });
  it('confirmada por cualquier vía, verde', () => {
    expect(semaforoDeCita({ ...base, conf1h: true })).toBe('verde');
    expect(semaforoDeCita({ ...base, conf30min: true })).toBe('verde');
    expect(semaforoDeCita({ ...base, confirmedAt: new Date() })).toBe('verde');
    expect(semaforoDeCita({ ...base, status: 'CONFIRMADA' })).toBe('verde');
  });
  it('realizada es verde aunque nadie confirmara antes', () => {
    expect(semaforoDeCita({ ...base, status: 'REALIZADA' })).toBe('verde');
  });
  it('cancelada o no asistió es rojo aunque hubiera confirmado', () => {
    expect(semaforoDeCita({ ...base, status: 'CANCELADA', conf1h: true })).toBe('rojo');
    expect(semaforoDeCita({ ...base, status: 'NO_ASISTIO', confirmedAt: new Date() })).toBe('rojo');
  });
});
