import { describe, it, expect } from 'vitest';
import type { Franja } from './horario-de-domicilios';
import {
  AGENDADO_POR_DEFECTO,
  describirAgendado,
  franjasDeAgendado,
  leerAjustesAgendado,
  rangoDelFiltro,
  validarAgendado,
  validarAjustesAgendado,
} from './pedidos-agendados';

/**
 * Pedidos agendados: qué días y horas se le ofrecen al cliente y qué acepta el
 * servidor. Es aritmética de calendario y de zonas horarias —medianoche,
 * horario de verano, días sin horario— que es donde se cuelan los errores de
 * un día o de una hora. Sin base de datos.
 */

const BOGOTA = 'America/Bogota';
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const HAMBURGUESERIA: Franja[] = [{ dias: TODOS, desde: '18:00', hasta: '01:00' }];
/** Un instante de Bogotá (UTC-5 todo el año). */
const bogota = (iso: string) => new Date(`${iso}:00-05:00`);
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const disponibles = (d: { horas: { minutos: number; disponible: boolean }[] }) =>
  d.horas.filter((h) => h.disponible).map((h) => hhmm(h.minutos));

describe('ajustes del negocio', () => {
  it('sin nada guardado: apagado, 48 h y 30 días', () => {
    expect(leerAjustesAgendado(null)).toEqual({ activo: false, ...AGENDADO_POR_DEFECTO });
    expect(leerAjustesAgendado({})).toEqual({ activo: false, anticipacionHoras: 48, diasMaximos: 30 });
  });

  it('un valor raro guardado vuelve al de por defecto, no tumba el checkout', () => {
    expect(
      leerAjustesAgendado({ pedidosAgendados: { activo: true, anticipacionHoras: 'x', diasMaximos: 999 } }),
    ).toEqual({ activo: true, anticipacionHoras: 48, diasMaximos: 30 });
  });

  it('«activo» solo con true de verdad', () => {
    expect(leerAjustesAgendado({ pedidosAgendados: { activo: 'true' } }).activo).toBe(false);
  });

  it('el panel no deja guardar rangos imposibles', () => {
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 48, diasMaximos: 30 }).ok).toBe(true);
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 0, diasMaximos: 1 }).ok).toBe(true);
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 721, diasMaximos: 90 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/0 a 30 días/),
    });
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: -1, diasMaximos: 30 }).ok).toBe(false);
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 2.5, diasMaximos: 30 }).ok).toBe(false);
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 24, diasMaximos: 0 }).ok).toBe(false);
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 24, diasMaximos: 91 }).ok).toBe(false);
    // Máximo IGUAL a la anticipación: no queda ninguna hora.
    expect(validarAjustesAgendado({ activo: true, anticipacionHoras: 48, diasMaximos: 2 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/mayor que la anticipación/),
    });
    expect(validarAjustesAgendado({ anticipacionHoras: 48 }).ok).toBe(false);
  });
});

describe('qué días y horas se ofrecen', () => {
  it('con 48 h de anticipación el primer día es pasado mañana', () => {
    // Jueves 8 de octubre al mediodía → el primer día es el sábado 10.
    const dias = franjasDeAgendado({
      horario: HAMBURGUESERIA,
      zona: BOGOTA,
      anticipacionHoras: 48,
      diasMaximos: 30,
      ahora: bogota('2026-10-08T12:00'),
    });
    expect(dias[0].fecha).toBe('2026-10-10');
    expect(dias[0].diaSemana).toBe(6);
    // Las 00:00 y 00:30 del sábado son de la franja del VIERNES: existen pero
    // caen antes de las 48 h.
    expect(dias[0].horas.slice(0, 2).map((h) => [hhmm(h.minutos), h.disponible])).toEqual([
      ['00:00', false],
      ['00:30', false],
    ]);
    expect(disponibles(dias[0])).toEqual([
      '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30',
      '22:00', '22:30', '23:00', '23:30',
    ]);
    // Último día: el 7 de noviembre (8 oct + 30 días).
    expect(dias[dias.length - 1].fecha).toBe('2026-11-07');
  });

  it('CRUCE DE MEDIANOCHE: las 00:30 del domingo son de la franja del sábado', () => {
    const dias = franjasDeAgendado({
      horario: HAMBURGUESERIA,
      zona: BOGOTA,
      anticipacionHoras: 48,
      diasMaximos: 30,
      ahora: bogota('2026-10-08T12:00'),
    });
    const domingo = dias.find((d) => d.fecha === '2026-10-11')!;
    expect(disponibles(domingo).slice(0, 2)).toEqual(['00:00', '00:30']);
    // La 1:00 ya no: la franja cierra a la 1 y el cierre no se incluye.
    expect(domingo.horas.map((h) => hhmm(h.minutos))).not.toContain('01:00');
    // El instante viaja en UTC: 00:30 del domingo en Bogotá = 05:30Z.
    expect(domingo.horas[1].instante).toBe('2026-10-11T05:30:00.000Z');
  });

  it('UN DÍA SIN HORARIO sale deshabilitado, no desaparece', () => {
    // Solo viernes y sábado de 12 a 15.
    const horario: Franja[] = [{ dias: [5, 6], desde: '12:00', hasta: '15:00' }];
    const dias = franjasDeAgendado({
      horario,
      zona: BOGOTA,
      anticipacionHoras: 0,
      diasMaximos: 7,
      ahora: bogota('2026-10-05T09:00'), // lunes
    });
    const lunes = dias.find((d) => d.fecha === '2026-10-05')!;
    expect(lunes.disponible).toBe(false);
    expect(lunes.horas).toEqual([]);
    const viernes = dias.find((d) => d.fecha === '2026-10-09')!;
    expect(disponibles(viernes)).toEqual(['12:00', '12:30', '13:00', '13:30', '14:00', '14:30']);
  });

  it('SIN HORARIO CONFIGURADO se ofrece de 8:00 a 20:00 (sin las 20:00)', () => {
    const dias = franjasDeAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 24,
      diasMaximos: 3,
      ahora: bogota('2026-10-08T06:00'),
    });
    const manana = dias.find((d) => d.fecha === '2026-10-09')!;
    expect(manana.horas).toHaveLength(24);
    expect(hhmm(manana.horas[0].minutos)).toBe('08:00');
    expect(hhmm(manana.horas[23].minutos)).toBe('19:30');
    expect(manana.horas.every((h) => h.disponible)).toBe(true);
  });

  it('BORDE DE ANTICIPACIÓN: justo a las N horas sí, media hora antes no', () => {
    const dias = franjasDeAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 2,
      diasMaximos: 2,
      ahora: bogota('2026-10-08T10:00'),
    });
    const hoy = dias.find((d) => d.fecha === '2026-10-08')!;
    const estado = Object.fromEntries(hoy.horas.map((h) => [hhmm(h.minutos), h.disponible]));
    expect(estado['11:30']).toBe(false);
    expect(estado['12:00']).toBe(true);
  });

  it('BORDE DEL MÁXIMO: lo que pasa de N días no se ofrece', () => {
    const dias = franjasDeAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 0,
      diasMaximos: 2,
      ahora: bogota('2026-10-08T10:00'),
    });
    const ultimo = dias[dias.length - 1];
    expect(ultimo.fecha).toBe('2026-10-10');
    const estado = Object.fromEntries(ultimo.horas.map((h) => [hhmm(h.minutos), h.disponible]));
    expect(estado['10:00']).toBe(true); // exactamente 48 h
    expect(estado['10:30']).toBe(false);
  });

  it('con anticipación 0 no se ofrece la hora que ya empezó', () => {
    const dias = franjasDeAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 0,
      diasMaximos: 1,
      ahora: bogota('2026-10-08T10:00'),
    });
    const estado = Object.fromEntries(dias[0].horas.map((h) => [hhmm(h.minutos), h.disponible]));
    expect(estado['10:00']).toBe(false);
    expect(estado['10:30']).toBe(true);
  });

  it('ZONA DISTINTA DE BOGOTÁ: Nueva York, con el cambio de hora de noviembre', () => {
    const NY = 'America/New_York';
    const dias = franjasDeAgendado({
      horario: [],
      zona: NY,
      anticipacionHoras: 0,
      diasMaximos: 10,
      ahora: new Date('2026-10-28T12:00:00Z'),
    });
    // Antes del cambio (EDT, UTC-4) las 8:00 son las 12:00Z; después (EST,
    // UTC-5), las 13:00Z. Sumar horas fijas daría una hora mal en una mitad.
    const antes = dias.find((d) => d.fecha === '2026-10-30')!;
    const despues = dias.find((d) => d.fecha === '2026-11-02')!;
    expect(antes.horas[0].instante).toBe('2026-10-30T12:00:00.000Z');
    expect(despues.horas[0].instante).toBe('2026-11-02T13:00:00.000Z');
    // El día del cambio (1 de noviembre) sigue teniendo sus 24 medias horas.
    expect(dias.find((d) => d.fecha === '2026-11-01')!.horas).toHaveLength(24);
  });

  it('el día lo decide la zona del NEGOCIO, no la del servidor', () => {
    // 2026-10-09T03:00Z: en UTC ya es viernes; en Bogotá aún es jueves 22:00.
    const dias = franjasDeAgendado({
      horario: HAMBURGUESERIA,
      zona: BOGOTA,
      anticipacionHoras: 0,
      diasMaximos: 1,
      ahora: new Date('2026-10-09T03:00:00Z'),
    });
    expect(dias[0].fecha).toBe('2026-10-08');
    expect(disponibles(dias[0])).toEqual(['22:30', '23:00', '23:30']);
  });

  it('una zona que no existe cae a Bogotá en vez de romper', () => {
    const a = franjasDeAgendado({ horario: [], zona: 'Marte/Olympus', anticipacionHoras: 24, diasMaximos: 2, ahora: bogota('2026-10-08T10:00') });
    const b = franjasDeAgendado({ horario: [], zona: BOGOTA, anticipacionHoras: 24, diasMaximos: 2, ahora: bogota('2026-10-08T10:00') });
    expect(a).toEqual(b);
  });
});

describe('lo que acepta el servidor', () => {
  const base = {
    horario: HAMBURGUESERIA,
    zona: BOGOTA,
    anticipacionHoras: 48,
    diasMaximos: 30,
    ahora: bogota('2026-10-08T12:00'),
  };

  it('una hora ofrecida pasa', () => {
    const r = validarAgendado({ ...base, instante: '2026-10-10T23:30:00.000Z' }); // sáb 18:30
    expect(r.ok).toBe(true);
  });

  it('el cruce de medianoche también pasa', () => {
    expect(validarAgendado({ ...base, instante: '2026-10-11T05:30:00.000Z' }).ok).toBe(true); // dom 00:30
    expect(validarAgendado({ ...base, instante: '2026-10-11T06:00:00.000Z' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no entrega domicilios/),
    }); // dom 01:00
  });

  it('antes de la anticipación no, y lo dice en días', () => {
    expect(validarAgendado({ ...base, instante: '2026-10-09T23:00:00.000Z' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/al menos 2 días de anticipación/),
    });
  });

  it('un par de minutos de retraso al rellenar no castiga al cliente', () => {
    // Eligió las 12:00 cuando eran las 10:00 (2 h); llega a las 10:04.
    const r = validarAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 2,
      diasMaximos: 2,
      ahora: bogota('2026-10-08T10:04'),
      instante: bogota('2026-10-08T12:00'),
    });
    expect(r.ok).toBe(true);
    const tarde = validarAgendado({
      horario: [],
      zona: BOGOTA,
      anticipacionHoras: 2,
      diasMaximos: 2,
      ahora: bogota('2026-10-08T10:06'),
      instante: bogota('2026-10-08T12:00'),
    });
    expect(tarde.ok).toBe(false);
  });

  it('más allá del máximo no', () => {
    expect(validarAgendado({ ...base, instante: '2026-11-08T23:30:00.000Z' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/hasta 30 días adelante/),
    });
  });

  it('una hora suelta (7:13) o con segundos no viene del selector', () => {
    expect(validarAgendado({ ...base, instante: '2026-10-11T00:13:00.000Z' }).ok).toBe(false);
    expect(validarAgendado({ ...base, instante: '2026-10-10T23:30:05.000Z' }).ok).toBe(false);
  });

  it('pasado, basura o vacío: no', () => {
    expect(validarAgendado({ ...base, instante: '2026-10-01T23:30:00.000Z' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/ya pasó/),
    });
    expect(validarAgendado({ ...base, instante: 'mañana' }).ok).toBe(false);
    expect(validarAgendado({ ...base, instante: '' }).ok).toBe(false);
  });

  it('el negocio sin horario acepta de 8 a 20 y nada más', () => {
    const sin = { ...base, horario: [] as Franja[] };
    expect(validarAgendado({ ...sin, instante: bogota('2026-10-12T08:00') }).ok).toBe(true);
    expect(validarAgendado({ ...sin, instante: bogota('2026-10-12T19:30') }).ok).toBe(true);
    expect(validarAgendado({ ...sin, instante: bogota('2026-10-12T20:00') }).ok).toBe(false);
    expect(validarAgendado({ ...sin, instante: bogota('2026-10-12T03:00') }).ok).toBe(false);
  });
});

describe('cómo se escribe la fecha', () => {
  it('en la zona del negocio, con nombres en español', () => {
    // 2026-10-11T00:30Z = sábado 10 de octubre, 7:30 p. m. en Bogotá.
    expect(describirAgendado('2026-10-11T00:30:00.000Z', BOGOTA)).toEqual({
      corto: 'sáb 10 oct · 7:30 p. m.',
      largo: 'sábado 10 de octubre · 7:30 p. m.',
      hora: '7:30 p. m.',
      fecha: '2026-10-10',
    });
    expect(describirAgendado(bogota('2026-10-09T12:00'), BOGOTA).corto).toBe('vie 9 oct · 12 p. m.');
    expect(describirAgendado(bogota('2026-10-14T00:00'), BOGOTA).corto).toBe('mié 14 oct · 12 a. m.');
  });
});

describe('filtros del panel', () => {
  it('«hoy» y «mañana» son días del negocio', () => {
    const ahora = new Date('2026-10-09T03:00:00Z'); // jueves 8, 22:00 en Bogotá
    expect(rangoDelFiltro('hoy', ahora, BOGOTA)).toEqual({
      desde: new Date('2026-10-08T05:00:00Z'),
      hasta: new Date('2026-10-09T05:00:00Z'),
    });
    expect(rangoDelFiltro('manana', ahora, BOGOTA).desde).toEqual(new Date('2026-10-09T05:00:00Z'));
    expect(rangoDelFiltro('semana', ahora, BOGOTA).hasta).toEqual(new Date('2026-10-15T05:00:00Z'));
    expect(rangoDelFiltro('todos', ahora, BOGOTA).hasta).toBeNull();
  });
});

describe('ESPEJO: la copia del frontend da exactamente lo mismo', () => {
  // La ruta va en una variable para que `tsc` no intente resolver el `.mjs`
  // del frontend (no tiene tipos para el backend); vitest lo carga igual.
  const RUTA = '../../../frontend/src/lib/pedidos-agendados.mjs';
  const casos: Array<Record<string, any>> = [
    { horario: HAMBURGUESERIA, zona: BOGOTA, anticipacionHoras: 48, diasMaximos: 30, ahora: bogota('2026-10-08T12:00') },
    { horario: [], zona: 'America/New_York', anticipacionHoras: 0, diasMaximos: 10, ahora: new Date('2026-10-28T12:00:00Z') },
    { horario: [{ dias: [5, 6], desde: '12:00', hasta: '15:00' }], zona: 'America/Santiago', anticipacionHoras: 5, diasMaximos: 14, ahora: new Date('2026-09-01T15:17:00Z') },
    { horario: [{ dias: [1, 3], desde: '22:00', hasta: '02:30' }], zona: 'Europe/Madrid', anticipacionHoras: 24, diasMaximos: 40, ahora: new Date('2026-10-20T10:00:00Z') },
  ];

  it('franjas, validación, textos y filtros', async () => {
    const front: any = await import(RUTA);
    for (const c of casos) {
      const back = franjasDeAgendado(c as any);
      expect(front.franjasDeAgendado(c)).toEqual(back);
      for (const d of back.slice(0, 5)) {
        for (const h of d.horas) {
          expect(front.validarAgendado({ ...c, instante: h.instante })).toEqual(
            validarAgendado({ ...(c as any), instante: h.instante }),
          );
          expect(front.describirAgendado(h.instante, c.zona)).toEqual(describirAgendado(h.instante, c.zona));
        }
      }
      for (const f of ['hoy', 'manana', 'semana', 'todos'] as const) {
        expect(front.rangoDelFiltro(f, c.ahora, c.zona)).toEqual(rangoDelFiltro(f, c.ahora, c.zona));
      }
    }
    for (const v of [
      { activo: true, anticipacionHoras: 48, diasMaximos: 2 },
      { activo: true, anticipacionHoras: 0, diasMaximos: 1 },
      { activo: 'si' },
      null,
    ]) {
      expect(front.validarAjustesAgendado(v)).toEqual(validarAjustesAgendado(v));
      expect(front.leerAjustesAgendado({ pedidosAgendados: v })).toEqual(
        leerAjustesAgendado({ pedidosAgendados: v }),
      );
    }
  });
});
