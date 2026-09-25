import { describe, it, expect } from 'vitest';
import {
  estaAbierto,
  proximaApertura,
  resumenDelHorario,
  validarHorario,
  type Franja,
} from './horario-de-domicilios';

/**
 * El caso de Javier: una hamburguesería de 6:00 p. m. a 1:00 a. m. Un cliente
 * entra al mediodía desde Instagram y arma un carrito que nadie va a atender.
 */

const BOGOTA = 'America/Bogota';
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const HAMBURGUESERIA: Franja[] = [{ dias: TODOS, desde: '18:00', hasta: '01:00' }];

/** Un instante de Bogotá como Date real (Bogotá = UTC-5 todo el año). */
const bogota = (iso: string) => new Date(`${iso}-05:00`);

describe('sin horario configurado', () => {
  it('se pide a cualquier hora — no se le cambia nada a quien no lo use', () => {
    expect(estaAbierto([], bogota('2026-09-25T12:00'), BOGOTA)).toBe(true);
    expect(estaAbierto(null, bogota('2026-09-25T03:00'), BOGOTA)).toBe(true);
    expect(estaAbierto(undefined, bogota('2026-09-25T23:59'), BOGOTA)).toBe(true);
  });

  it('no hay nada que anunciar', () => {
    expect(proximaApertura([], bogota('2026-09-25T12:00'), BOGOTA)).toBeNull();
    expect(resumenDelHorario([])).toBeNull();
  });
});

describe('la hamburguesería de 6 p. m. a 1 a. m.', () => {
  it('AL MEDIODÍA ESTÁ CERRADA — el caso del reporte', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T12:00'), BOGOTA)).toBe(false);
  });

  it('y se le dice al cliente cuándo volver', () => {
    expect(proximaApertura(HAMBURGUESERIA, bogota('2026-09-25T12:00'), BOGOTA)).toBe(
      'hoy a las 6 p. m.',
    );
  });

  it('a las 6 en punto ya abre', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T18:00'), BOGOTA)).toBe(true);
  });

  it('a las 5:59 todavía no', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T17:59'), BOGOTA)).toBe(false);
  });

  it('a las 11 de la noche sigue abierta', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T23:00'), BOGOTA)).toBe(true);
  });

  it('A LAS 00:30 DEL DÍA SIGUIENTE SIGUE ABIERTA — la franja cruza la medianoche', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-26T00:30'), BOGOTA)).toBe(true);
  });

  it('a la 1:00 en punto ya cerró', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-26T01:00'), BOGOTA)).toBe(false);
  });
});

describe('la franja pertenece al día en que EMPIEZA', () => {
  // Solo los viernes por la noche. El sábado a las 00:30 todavía se pide.
  const soloViernes: Franja[] = [{ dias: [5], desde: '20:00', hasta: '02:00' }];

  it('el viernes a las 21:00 está abierta', () => {
    expect(estaAbierto(soloViernes, bogota('2026-09-25T21:00'), BOGOTA)).toBe(true);
  });

  it('el sábado a las 00:30 sigue abierta (es la noche del viernes)', () => {
    expect(estaAbierto(soloViernes, bogota('2026-09-26T00:30'), BOGOTA)).toBe(true);
  });

  it('el sábado a las 21:00 está CERRADA: esa noche no trabaja', () => {
    expect(estaAbierto(soloViernes, bogota('2026-09-26T21:00'), BOGOTA)).toBe(false);
  });
});

describe('cada negocio en SU hora, no en la del servidor', () => {
  it('las 18:00 de Bogotá son las 19:00 de Nueva York', () => {
    const instante = bogota('2026-09-25T18:00');
    expect(estaAbierto(HAMBURGUESERIA, instante, 'America/Bogota')).toBe(true);
    // En Nueva York ya son las 19:00: también dentro de la franja.
    expect(estaAbierto(HAMBURGUESERIA, instante, 'America/New_York')).toBe(true);
    // A las 13:00 de Bogotá son las 14:00 en NY: cerrado en los dos.
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T13:00'), 'America/New_York')).toBe(false);
  });

  it('una zona corrupta no tumba el pedido: cae a Bogotá', () => {
    expect(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T20:00'), 'Zona/Inventada')).toBe(true);
  });
});

describe('horario de oficina normal, sin cruzar medianoche', () => {
  const oficina: Franja[] = [{ dias: [1, 2, 3, 4, 5], desde: '09:00', hasta: '18:00' }];

  it('el lunes a las 10 abre', () => {
    expect(estaAbierto(oficina, bogota('2026-09-21T10:00'), BOGOTA)).toBe(true);
  });

  it('el domingo no', () => {
    expect(estaAbierto(oficina, bogota('2026-09-27T10:00'), BOGOTA)).toBe(false);
  });

  it('el sábado dice que vuelva el lunes', () => {
    expect(proximaApertura(oficina, bogota('2026-09-26T10:00'), BOGOTA)).toBe(
      'el lunes a las 9 a. m.',
    );
  });

  it('un domingo por la noche, mañana', () => {
    expect(proximaApertura(oficina, bogota('2026-09-27T22:00'), BOGOTA)).toBe(
      'mañana a las 9 a. m.',
    );
  });
});

describe('lo que llega del panel se valida', () => {
  it('vacío o nulo es válido: significa todo el día', () => {
    expect(validarHorario(null)).toEqual({ ok: true, franjas: [] });
    expect(validarHorario([])).toEqual({ ok: true, franjas: [] });
  });

  it('una franja buena pasa, con los días ordenados y sin repetir', () => {
    const r = validarHorario([{ dias: [5, 1, 1], desde: '18:00', hasta: '01:00' }]);
    expect(r).toEqual({ ok: true, franjas: [{ dias: [1, 5], desde: '18:00', hasta: '01:00' }] });
  });

  it('sin días, se rechaza', () => {
    expect(validarHorario([{ dias: [], desde: '18:00', hasta: '01:00' }]).ok).toBe(false);
  });

  it('un día fuera de 0-6, se rechaza', () => {
    expect(validarHorario([{ dias: [7], desde: '18:00', hasta: '01:00' }]).ok).toBe(false);
  });

  it('una hora mal escrita, se rechaza', () => {
    expect(validarHorario([{ dias: [1], desde: '25:00', hasta: '01:00' }]).ok).toBe(false);
    expect(validarHorario([{ dias: [1], desde: '6pm', hasta: '01:00' }]).ok).toBe(false);
  });

  it('inicio igual a cierre, se rechaza y se explica', () => {
    // Es ambiguo: ¿cero minutos o el día entero? Para el día entero, vacío.
    const r = validarHorario([{ dias: [1], desde: '18:00', hasta: '18:00' }]);
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/deja el horario vac/i);
  });
});

describe('el resumen que se pinta', () => {
  it('todos los días, en 12 horas', () => {
    expect(resumenDelHorario(HAMBURGUESERIA)).toBe('todos los días: 6 p. m. – 1 a. m.');
  });

  it('con minutos y días sueltos', () => {
    expect(resumenDelHorario([{ dias: [5, 6], desde: '18:30', hasta: '23:00' }])).toBe(
      'viernes, sábado: 6:30 p. m. – 11 p. m.',
    );
  });
});
