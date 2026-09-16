import { describe, expect, it } from 'vitest';
import {
  AJUSTES_DE_AGENDA_POR_DEFECTO,
  MAX_CUPOS_POR_HORARIO,
  MAX_DIAS_HACIA_ADELANTE,
  esFecha,
  hoyEnBogota,
  leerAjustesDeAgenda,
  normalizarAjustesDeAgenda,
} from './ajustes-de-agenda';

describe('esFecha', () => {
  it('solo fechas que existen', () => {
    expect(esFecha('2026-09-15')).toBe(true);
    expect(esFecha('2026-02-30')).toBe(false);
    expect(esFecha('15/09/2026')).toBe(false);
    expect(esFecha(20260915)).toBe(false);
  });
});

describe('hoyEnBogota', () => {
  it('el día en Bogotá, no en UTC', () => {
    expect(hoyEnBogota(new Date('2026-09-16T03:00:00Z'))).toBe('2026-09-15');
  });
});

describe('normalizarAjustesDeAgenda', () => {
  it('devuelve solo lo que llegó, limpio', () => {
    expect(normalizarAjustesDeAgenda({ titulo: '  Reunión estratégica ', duracionMin: '45' })).toEqual({
      titulo: 'Reunión estratégica',
      duracionMin: 45,
    });
    expect(normalizarAjustesDeAgenda({ subtitulo: '' })).toEqual({ subtitulo: null });
  });

  it('las fechas bloqueadas, ordenadas y sin repetir; una mala lo frena todo', () => {
    expect(normalizarAjustesDeAgenda({ fechasBloqueadas: ['2026-12-25', '2026-12-24', '2026-12-25'] }, '2026-09-15')).toEqual({
      fechasBloqueadas: ['2026-12-24', '2026-12-25'],
    });
    expect(normalizarAjustesDeAgenda({ fechasBloqueadas: ['2026-12-25', 'navidad'] }, '2026-09-15')).toEqual({
      error: '«navidad» no es una fecha (AAAA-MM-DD)',
    });
  });

  it('las fechas bloqueadas que ya pasaron se descartan', () => {
    expect(normalizarAjustesDeAgenda({ fechasBloqueadas: ['2026-09-14', '2026-09-15', '2026-12-25'] }, '2026-09-15')).toEqual({
      fechasBloqueadas: ['2026-09-15', '2026-12-25'],
    });
    expect(leerAjustesDeAgenda({ fechasBloqueadas: ['2025-01-01', '2026-12-25'] }, '2026-09-15').fechasBloqueadas).toEqual([
      '2026-12-25',
    ]);
  });

  it('rechaza duraciones, días y antelaciones fuera de lo ofrecido', () => {
    expect(normalizarAjustesDeAgenda({ duracionMin: 37 })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ diasHaciaAdelante: MAX_DIAS_HACIA_ADELANTE + 1 })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ diasHaciaAdelante: 0 })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ antelacionMin: 45 })).toHaveProperty('error');
  });

  it('el tiempo de redirección solo entre los que se ofrecen', () => {
    expect(normalizarAjustesDeAgenda({ redirigirEnSegundos: 5 })).toEqual({ redirigirEnSegundos: 5 });
    expect(normalizarAjustesDeAgenda({ redirigirEnSegundos: 0 })).toEqual({ redirigirEnSegundos: 0 });
    expect(normalizarAjustesDeAgenda({ redirigirEnSegundos: 7 })).toHaveProperty('error');
  });

  it('«Volver al sitio» solo con http(s)', () => {
    expect(normalizarAjustesDeAgenda({ volverAlSitio: 'https://sellea.co' })).toEqual({ volverAlSitio: 'https://sellea.co/' });
    expect(normalizarAjustesDeAgenda({ volverAlSitio: 'javascript:alert(1)' })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ volverAlSitio: '' })).toEqual({ volverAlSitio: null });
  });

  it('lo que no es un objeto no vale', () => {
    expect(normalizarAjustesDeAgenda(null)).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda([])).toHaveProperty('error');
  });
});

describe('leerAjustesDeAgenda', () => {
  it('sin nada guardado, lo de siempre (y convive con formularioId)', () => {
    expect(leerAjustesDeAgenda({})).toEqual(AJUSTES_DE_AGENDA_POR_DEFECTO);
    expect(leerAjustesDeAgenda({ formularioId: 'f1' })).toEqual(AJUSTES_DE_AGENDA_POR_DEFECTO);
    expect(leerAjustesDeAgenda(null)).toEqual(AJUSTES_DE_AGENDA_POR_DEFECTO);
  });

  it('sin sitio al que volver no se redirige, aunque lo guardado diga otra cosa', () => {
    expect(leerAjustesDeAgenda({ redirigirEnSegundos: 10 }).redirigirEnSegundos).toBe(0);
    expect(
      leerAjustesDeAgenda({ volverAlSitio: 'https://sellea.co', redirigirEnSegundos: 10 }).redirigirEnSegundos,
    ).toBe(10);
  });

  it('lo roto vuelve al valor por defecto, campo a campo', () => {
    const a = leerAjustesDeAgenda({
      titulo: 'Demo',
      duracionMin: 999,
      diasHaciaAdelante: 'muchos',
      antelacionMin: 60,
      fechasBloqueadas: ['2026-12-25', 'x', '2026-12-25'],
      volverAlSitio: 'javascript:alert(1)',
    }, '2026-09-15');
    expect(a).toEqual({
      ...AJUSTES_DE_AGENDA_POR_DEFECTO,
      titulo: 'Demo',
      antelacionMin: 60,
      fechasBloqueadas: ['2026-12-25'],
    });
  });
});

describe('el horario, los bloques y las reservas por horario', () => {
  it('el horario se ordena, y un tramo roto o que pisa a otro se rechaza', () => {
    expect(
      normalizarAjustesDeAgenda({
        franjas: [
          { weekday: 3, startMin: 540, endMin: 600 },
          { weekday: 1, startMin: 540, endMin: 1080 },
        ],
      }),
    ).toEqual({
      franjas: [
        { weekday: 1, startMin: 540, endMin: 1080 },
        { weekday: 3, startMin: 540, endMin: 600 },
      ],
    });
    expect(normalizarAjustesDeAgenda({ franjas: [{ weekday: 1, startMin: 600, endMin: 540 }] })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ franjas: [{ weekday: 7, startMin: 540, endMin: 600 }] })).toHaveProperty('error');
    expect(
      normalizarAjustesDeAgenda({
        franjas: [
          { weekday: 1, startMin: 540, endMin: 720 },
          { weekday: 1, startMin: 600, endMin: 780 },
        ],
      }),
    ).toEqual({ error: 'Hay dos tramos que se pisan el mismo día. Únelos en uno.' });
    expect(normalizarAjustesDeAgenda({ franjas: [] })).toEqual({ franjas: [] });
  });

  it('bloques y reservas por horario, solo entre lo que se ofrece', () => {
    expect(normalizarAjustesDeAgenda({ pasoMin: 30, cuposPorHorario: 4 })).toEqual({ pasoMin: 30, cuposPorHorario: 4 });
    expect(normalizarAjustesDeAgenda({ pasoMin: 25 })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ cuposPorHorario: 0 })).toHaveProperty('error');
    expect(normalizarAjustesDeAgenda({ cuposPorHorario: MAX_CUPOS_POR_HORARIO + 1 })).toHaveProperty('error');
  });

  it('al leer, un tramo roto se descarta él solo, y sin bloques ni cupos vale lo de la agenda única', () => {
    const a = leerAjustesDeAgenda({
      franjas: [
        { weekday: 2, startMin: 540, endMin: 660 },
        { weekday: 2, startMin: 600, endMin: 700 },
        'basura',
        { weekday: 9, startMin: 0, endMin: 60 },
      ],
    });
    expect(a.franjas).toEqual([{ weekday: 2, startMin: 540, endMin: 660 }]);
    expect(a.pasoMin).toBe(15);
    expect(a.cuposPorHorario).toBe(1);
  });
});
