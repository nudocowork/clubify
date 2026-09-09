import { describe, it, expect } from 'vitest';
import {
  diaDeLaSemanaEn,
  errorDeFranja,
  etiquetaDeMinutos,
  fechaEn,
  fechaValida,
  huecosDelDia,
  minutosLocalesAUtc,
} from './franjas-horarias';

const BOGOTA = 'America/Bogota';
/** Zona CON horario de verano, para probar que el desfase no se supone. */
const MADRID = 'Europe/Madrid';

const iso = (d: Date) => d.toISOString();

describe('la hora local se convierte a UTC midiendo el desfase, no suponiéndolo', () => {
  it('las 9 de la mañana en Bogotá son las 14:00 UTC', () => {
    expect(iso(minutosLocalesAUtc('2026-09-08', 9 * 60, BOGOTA))).toBe(
      '2026-09-08T14:00:00.000Z',
    );
  });

  it('medianoche en Bogotá son las 05:00 UTC del mismo día', () => {
    expect(iso(minutosLocalesAUtc('2026-09-08', 0, BOGOTA))).toBe(
      '2026-09-08T05:00:00.000Z',
    );
  });

  it('Madrid en INVIERNO va +1: las 9 son las 08:00 UTC', () => {
    expect(iso(minutosLocalesAUtc('2026-01-15', 9 * 60, MADRID))).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('Madrid en VERANO va +2: las mismas 9 son las 07:00 UTC', () => {
    // Este es el caso que rompe cualquier «súmale las horas de la zona»: la
    // misma hora local cae en dos instantes distintos según el mes.
    expect(iso(minutosLocalesAUtc('2026-07-15', 9 * 60, MADRID))).toBe(
      '2026-07-15T07:00:00.000Z',
    );
  });
});

describe('el día de la semana se mira desde la zona, no desde UTC', () => {
  it('el 8 de septiembre de 2026 es martes', () => {
    expect(diaDeLaSemanaEn('2026-09-08', BOGOTA)).toBe(2);
  });

  it('un domingo es 0, que es lo que guarda la tabla', () => {
    expect(diaDeLaSemanaEn('2026-09-06', BOGOTA)).toBe(0);
  });

  it('no se corre por mirar a las 00:00 UTC', () => {
    // A las 00:00 UTC del lunes, Bogotá sigue en domingo. Por eso se mira a
    // mediodía: si no, el horario del lunes se aplicaría en domingo.
    expect(diaDeLaSemanaEn('2026-09-07', BOGOTA)).toBe(1);
  });
});

describe('la fecha de un instante, vista desde la zona', () => {
  it('la 1 de la madrugada UTC todavía es el día anterior en Bogotá', () => {
    expect(fechaEn(new Date('2026-10-01T01:00:00Z'), BOGOTA)).toBe('2026-09-30');
  });
});

describe('fechas que no existen', () => {
  it('el 31 de febrero pasa el patrón pero no es una fecha', () => {
    expect(fechaValida('2026-02-31')).toBe(false);
    expect(fechaValida('2026-13-01')).toBe(false);
  });

  it('las de verdad valen', () => {
    expect(fechaValida('2026-02-28')).toBe(true);
    expect(fechaValida('2028-02-29')).toBe(true); // bisiesto
  });

  it('lo que no tiene forma de fecha, tampoco', () => {
    expect(fechaValida('mañana')).toBe(false);
    expect(fechaValida('2026-9-8')).toBe(false);
  });
});

describe('los huecos del día', () => {
  const base = {
    fecha: '2026-09-08',
    zona: BOGOTA,
    franjas: [{ startMin: 9 * 60, endMin: 11 * 60 }],
    ocupado: [],
    duracionMin: 30,
    // Muy anterior al día, para que nada se filtre por «ya pasó».
    ahora: new Date('2026-09-01T00:00:00Z'),
  };

  it('de 9 a 11 con citas de 30 min y paso de 15 salen siete huecos', () => {
    // El ultimo arranca a las 10:30 y termina justo a las 11:00: cabe.
    const h = huecosDelDia(base);
    expect(h.map((x) => x.label)).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
    ]);
  });

  it('el último hueco NO se sale de la franja', () => {
    // 10:30 + 30 min = 11:00, justo el borde: entra. 10:45 se saldría.
    const h = huecosDelDia({ ...base, pasoMin: 30 });
    expect(h.at(-1)?.label).toBe('10:30');
  });

  it('una cita ocupada tapa los huecos que la pisan', () => {
    const h = huecosDelDia({
      ...base,
      ocupado: [
        {
          startAt: new Date('2026-09-08T14:30:00Z'), // 09:30 Bogotá
          endAt: new Date('2026-09-08T15:00:00Z'), // 10:00
        },
      ],
    });
    // Caen tres: 09:15 y 09:45 tambien pisan la cita, no solo el 09:30.
    expect(h.map((x) => x.label)).toEqual(['09:00', '10:00', '10:15', '10:30']);
  });

  it('una cita que TERMINA cuando empieza el hueco no estorba', () => {
    // Es lo que permite encadenar dos citas seguidas. Con un `<=` mal puesto,
    // el negocio perdería la mitad de su agenda.
    const h = huecosDelDia({
      ...base,
      pasoMin: 30,
      ocupado: [
        {
          startAt: new Date('2026-09-08T14:00:00Z'), // 09:00
          endAt: new Date('2026-09-08T14:30:00Z'), // 09:30
        },
      ],
    });
    expect(h.map((x) => x.label)).toEqual(['09:30', '10:00', '10:30']);
  });

  it('lo que ya pasó no se ofrece', () => {
    const h = huecosDelDia({
      ...base,
      pasoMin: 30,
      ahora: new Date('2026-09-08T14:45:00Z'), // 09:45 Bogotá
    });
    expect(h.map((x) => x.label)).toEqual(['10:00', '10:30']);
  });

  it('con antelación mínima tampoco se ofrece lo de dentro de dos minutos', () => {
    // Sin esto, alguien reserva a las 09:59 para las 10:00 y el vendedor se
    // entera cuando ya llegó el cliente.
    const h = huecosDelDia({
      ...base,
      pasoMin: 30,
      ahora: new Date('2026-09-08T14:50:00Z'), // 09:50
      antelacionMin: 30,
    });
    expect(h.map((x) => x.label)).toEqual(['10:30']);
  });

  it('dos franjas que se solapan no duplican el hueco', () => {
    const h = huecosDelDia({
      ...base,
      pasoMin: 60,
      franjas: [
        { startMin: 9 * 60, endMin: 11 * 60 },
        { startMin: 9 * 60, endMin: 10 * 60 },
      ],
    });
    expect(h.map((x) => x.label)).toEqual(['09:00', '10:00']);
  });

  it('salen ordenados aunque las franjas vengan al revés', () => {
    const h = huecosDelDia({
      ...base,
      pasoMin: 60,
      franjas: [
        { startMin: 15 * 60, endMin: 16 * 60 },
        { startMin: 9 * 60, endMin: 10 * 60 },
      ],
    });
    expect(h.map((x) => x.label)).toEqual(['09:00', '15:00']);
  });

  it('sin franjas, sin huecos: un día libre no se inventa', () => {
    expect(huecosDelDia({ ...base, franjas: [] })).toEqual([]);
  });

  it('una duración que no cabe en la franja no da nada', () => {
    expect(huecosDelDia({ ...base, duracionMin: 180 })).toEqual([]);
  });

  it('valores absurdos no revientan ni devuelven basura', () => {
    expect(huecosDelDia({ ...base, duracionMin: 0 })).toEqual([]);
    expect(huecosDelDia({ ...base, pasoMin: 0 })).toEqual([]);
    expect(huecosDelDia({ ...base, fecha: '2026-02-31' })).toEqual([]);
    expect(
      huecosDelDia({ ...base, franjas: [{ startMin: NaN, endMin: 600 }] }),
    ).toEqual([]);
  });

  it('los huecos son instantes UTC de verdad, no cadenas locales', () => {
    const h = huecosDelDia({ ...base, pasoMin: 60 });
    expect(iso(h[0].startAt)).toBe('2026-09-08T14:00:00.000Z');
  });
});

describe('la etiqueta que ve el cliente', () => {
  it('siempre con dos dígitos', () => {
    expect(etiquetaDeMinutos(0)).toBe('00:00');
    expect(etiquetaDeMinutos(570)).toBe('09:30');
    expect(etiquetaDeMinutos(1439)).toBe('23:59');
  });
});

describe('lo que no se puede guardar como horario', () => {
  it('el fin tiene que ir después del inicio', () => {
    expect(errorDeFranja({ startMin: 600, endMin: 600 })).toContain('posterior');
    expect(errorDeFranja({ startMin: 600, endMin: 540 })).toContain('posterior');
  });

  it('tiene que caber en el día', () => {
    expect(errorDeFranja({ startMin: -1, endMin: 600 })).toContain('día');
    expect(errorDeFranja({ startMin: 600, endMin: 1441 })).toContain('día');
  });

  it('nada de decimales', () => {
    expect(errorDeFranja({ startMin: 9.5, endMin: 600 })).toContain('enteros');
  });

  it('un horario normal pasa', () => {
    expect(errorDeFranja({ startMin: 540, endMin: 1080 })).toBeNull();
    expect(errorDeFranja({ startMin: 0, endMin: 1440 })).toBeNull();
  });
});
