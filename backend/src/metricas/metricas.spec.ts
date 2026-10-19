import { describe, expect, it } from 'vitest';
import {
  RangoInvalido,
  diasDelRango,
  granularidadDe,
  hoyBogota,
  limitesUtc,
  lunesDe,
  periodoAnterior,
  rangoDePreset,
  sumaEnRango,
  tramosDeSerie,
  variacion,
} from './rango';
import { clasificarUso, negociosSinClientesNuevos, topCrecimiento, type NegocioBase } from './negocios';

// 19 oct 2026, 02:00 UTC = 18 oct, 9 p. m. en Bogotá: el caso que rompe si se
// corta el día en UTC.
const NOCHE = new Date('2026-10-19T02:00:00Z');
const MEDIODIA = new Date('2026-10-19T17:00:00Z');

describe('día de Bogotá', () => {
  it('a las 9 p. m. de Bogotá sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    expect(hoyBogota(NOCHE)).toBe('2026-10-18');
    expect(hoyBogota(MEDIODIA)).toBe('2026-10-19');
  });

  it('la medianoche de Bogotá es las 05:00 UTC y el final es exclusivo', () => {
    const l = limitesUtc({ desde: '2026-10-01', hasta: '2026-10-19' });
    expect(l.gte.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(l.lt.toISOString()).toBe('2026-10-20T05:00:00.000Z');
  });
});

describe('rangoDePreset', () => {
  it('hoy, 7, 30 y 90 días cuentan el día de hoy', () => {
    expect(rangoDePreset('hoy', MEDIODIA)).toEqual({ desde: '2026-10-19', hasta: '2026-10-19' });
    expect(diasDelRango(rangoDePreset('7d', MEDIODIA))).toBe(7);
    expect(rangoDePreset('30d', MEDIODIA)).toEqual({ desde: '2026-09-20', hasta: '2026-10-19' });
    expect(diasDelRango(rangoDePreset('90d', MEDIODIA))).toBe(90);
  });

  it('este mes va del 1 a hoy; el mes anterior es el mes completo', () => {
    expect(rangoDePreset('mes', MEDIODIA)).toEqual({ desde: '2026-10-01', hasta: '2026-10-19' });
    expect(rangoDePreset('mesAnterior', MEDIODIA)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
  });

  it('en enero el mes anterior es diciembre del año pasado', () => {
    expect(rangoDePreset('mesAnterior', new Date('2027-01-10T15:00:00Z'))).toEqual({
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });
  });

  it('personalizado: recorta el futuro a hoy y rechaza fechas malas', () => {
    expect(rangoDePreset('personalizado', MEDIODIA, '2026-10-01', '2026-10-31')).toEqual({
      desde: '2026-10-01',
      hasta: '2026-10-19',
    });
    expect(() => rangoDePreset('personalizado', MEDIODIA, '2026-10-10', '2026-10-01')).toThrow(RangoInvalido);
    expect(() => rangoDePreset('personalizado', MEDIODIA, '2026-02-31', '2026-03-01')).toThrow(RangoInvalido);
    expect(() => rangoDePreset('personalizado', MEDIODIA)).toThrow(RangoInvalido);
    expect(() => rangoDePreset('personalizado', MEDIODIA, '2020-01-01', '2026-10-01')).toThrow(RangoInvalido);
  });
});

describe('periodoAnterior', () => {
  it('rangos de N días: los N días justo antes', () => {
    const r = rangoDePreset('30d', MEDIODIA);
    expect(periodoAnterior(r, '30d')).toEqual({ desde: '2026-08-21', hasta: '2026-09-19' });
    expect(periodoAnterior(rangoDePreset('hoy', MEDIODIA), 'hoy')).toEqual({
      desde: '2026-10-18',
      hasta: '2026-10-18',
    });
  });

  it('este mes se compara con los mismos días del mes anterior', () => {
    const r = rangoDePreset('mes', MEDIODIA);
    expect(periodoAnterior(r, 'mes')).toEqual({ desde: '2026-09-01', hasta: '2026-09-19' });
  });

  it('el 31 de marzo compara con todo febrero (no se sale del mes)', () => {
    const r = rangoDePreset('mes', new Date('2026-03-31T15:00:00Z'));
    expect(periodoAnterior(r, 'mes')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('el mes anterior se compara con el mes completo de antes', () => {
    const r = rangoDePreset('mesAnterior', MEDIODIA);
    expect(periodoAnterior(r, 'mesAnterior')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
  });

  it('personalizado: misma duración justo antes', () => {
    const r = { desde: '2026-10-05', hasta: '2026-10-11' };
    expect(periodoAnterior(r, 'personalizado')).toEqual({ desde: '2026-09-28', hasta: '2026-10-04' });
  });
});

describe('tramos por día y por semana', () => {
  it('hasta 62 días por día; más, por semana', () => {
    expect(granularidadDe({ desde: '2026-09-20', hasta: '2026-10-19' })).toBe('dia');
    expect(granularidadDe(rangoDePreset('90d', MEDIODIA))).toBe('semana');
  });

  it('el lunes de la semana', () => {
    expect(lunesDe('2026-10-19')).toBe('2026-10-19'); // lunes
    expect(lunesDe('2026-10-18')).toBe('2026-10-12'); // domingo
    expect(lunesDe('2026-10-01')).toBe('2026-09-28'); // jueves
  });

  it('por día rellena con ceros los días sin filas', () => {
    const t = tramosDeSerie({ desde: '2026-10-01', hasta: '2026-10-03' }, 'dia', {
      pases: new Map([['2026-10-02', 4]]),
    });
    expect(t.map((x) => [x.desde, x.valores.pases])).toEqual([
      ['2026-10-01', 0],
      ['2026-10-02', 4],
      ['2026-10-03', 0],
    ]);
  });

  it('por semana recorta la primera y la última al rango y suma cada serie', () => {
    const r = { desde: '2026-10-01', hasta: '2026-10-14' }; // jue 1 → mié 14
    const t = tramosDeSerie(r, 'semana', {
      a: new Map([
        ['2026-09-30', 100], // fuera del rango: no cuenta
        ['2026-10-01', 1],
        ['2026-10-04', 2],
        ['2026-10-05', 3],
        ['2026-10-14', 4],
      ]),
      b: new Map([['2026-10-12', 7]]),
    });
    expect(t).toEqual([
      { desde: '2026-10-01', hasta: '2026-10-04', valores: { a: 3, b: 0 } },
      { desde: '2026-10-05', hasta: '2026-10-11', valores: { a: 3, b: 0 } },
      { desde: '2026-10-12', hasta: '2026-10-14', valores: { a: 4, b: 7 } },
    ]);
  });

  it('sumaEnRango ignora los días de fuera', () => {
    const s = new Map([
      ['2026-09-19', 5],
      ['2026-09-20', 1],
      ['2026-10-19', 2],
      ['2026-10-20', 9],
    ]);
    expect(sumaEnRango(s, { desde: '2026-09-20', hasta: '2026-10-19' })).toBe(3);
  });
});

describe('variacion', () => {
  it('▲ y ▼ con un decimal', () => {
    expect(variacion(150, 100)).toEqual({ pct: 50, tendencia: 'sube' });
    expect(variacion(2, 3)).toEqual({ pct: -33.3, tendencia: 'baja' });
    expect(variacion(7, 7)).toEqual({ pct: 0, tendencia: 'igual' });
  });

  it('desde cero no hay %: es «nuevo»', () => {
    expect(variacion(5, 0)).toEqual({ pct: null, tendencia: 'nuevo' });
    expect(variacion(0, 0)).toEqual({ pct: 0, tendencia: 'igual' });
    expect(variacion(0, 4)).toEqual({ pct: -100, tendencia: 'baja' });
  });
});

describe('negocios sin clientes nuevos', () => {
  const ahora = new Date('2026-10-19T17:00:00Z');
  const hace = (d: number) => new Date(ahora.getTime() - d * 86_400_000);
  const negocios: NegocioBase[] = [
    { id: 'a', nombre: 'Arepas', estado: 'ACTIVE', creadoEn: hace(400) },
    { id: 'b', nombre: 'Barbería', estado: 'ACTIVE', creadoEn: hace(300) },
    { id: 'c', nombre: 'Café', estado: 'TRIAL', creadoEn: hace(10) },
    { id: 'd', nombre: 'Droguería', estado: 'ACTIVE', creadoEn: hace(200) },
    { id: 'e', nombre: 'Estética', estado: 'SUSPENDED', creadoEn: hace(500) },
  ];
  const clientes = new Map([
    ['a', { nuevosEnRango: 0, total: 120, ultimoClienteEn: hace(45) }],
    ['b', { nuevosEnRango: 3, total: 80, ultimoClienteEn: hace(1) }],
    ['c', { nuevosEnRango: 0, total: 2, ultimoClienteEn: hace(5) }],
    // 'd' nunca registró un cliente: no aparece en el mapa.
    ['e', { nuevosEnRango: 0, total: 9, ultimoClienteEn: hace(300) }],
  ]);
  const sellos = new Map<string, Date | null>([['a', hace(2)]]);

  const filas = negociosSinClientesNuevos(negocios, clientes, sellos, ahora);

  it('deja fuera a quien sí registró clientes y a los suspendidos', () => {
    expect(filas.map((f) => f.id)).not.toContain('b');
    expect(filas.map((f) => f.id)).not.toContain('e');
  });

  it('ordena por días quedado; el que nunca tuvo clientes cuenta desde su alta', () => {
    expect(filas.map((f) => [f.id, f.diasQuedado])).toEqual([
      ['d', 200],
      ['a', 45],
      ['c', 5],
    ]);
    expect(filas[0].diasSinClienteNuevo).toBeNull();
    expect(filas[0].totalClientes).toBe(0);
  });

  it('marca los de prueba y trae el último sello', () => {
    expect(filas.find((f) => f.id === 'c')?.enPrueba).toBe(true);
    expect(filas.find((f) => f.id === 'a')?.ultimoSelloEn).toEqual(hace(2));
    expect(filas.find((f) => f.id === 'd')?.ultimoSelloEn).toBeNull();
  });
});

describe('uso del sistema y crecimiento', () => {
  const base = (id: string, estado: NegocioBase['estado']): NegocioBase => ({
    id,
    nombre: id.toUpperCase(),
    estado,
    creadoEn: new Date('2026-01-01'),
  });

  it('solo cuenta ACTIVOS y lista los que no movieron nada', () => {
    const u = clasificarUso(
      [base('a', 'ACTIVE'), base('b', 'ACTIVE'), base('c', 'TRIAL'), base('d', 'SUSPENDED')],
      new Set(['a', 'c']),
    );
    expect(u.activos).toBe(2);
    expect(u.usan).toBe(1);
    expect(u.sinUso.map((x) => x.id)).toEqual(['b']);
  });

  it('top por pases absolutos, sin los que no emitieron, empate a favor de quien venía de menos', () => {
    const neg = ['a', 'b', 'c', 'd'].map((id) => ({ id, nombre: id }));
    const top = topCrecimiento(
      neg,
      new Map([
        ['a', 4],
        ['b', 400],
        ['c', 4],
      ]),
      new Map([
        ['a', 1],
        ['c', 0],
        ['d', 50],
      ]),
      2,
    );
    expect(top.map((x) => x.id)).toEqual(['b', 'c']);
  });
});
