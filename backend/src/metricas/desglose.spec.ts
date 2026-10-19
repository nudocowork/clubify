import { describe, expect, it } from 'vitest';
import {
  armarTabla,
  canjesPorTipoDelNegocio,
  repartirPorNegocio,
  resumirCanjes,
  tipoDeCanje,
  type EntradaNegocio,
  type FilaCanje,
} from './desglose';
import { diaBogotaDe, limitesUtc, periodoAnterior, rangoDePreset, sumaEnRango, type Preset } from './rango';
import { clasificarUso, type NegocioBase } from './negocios';

const MEDIODIA = new Date('2026-10-19T17:00:00Z');

const NEGOCIOS: NegocioBase[] = [
  { id: 'a', nombre: 'Arepas Doña Rosa', estado: 'ACTIVE', creadoEn: new Date('2026-01-01') },
  { id: 'b', nombre: 'Barbería Primor', estado: 'ACTIVE', creadoEn: new Date('2026-01-01') },
  { id: 'c', nombre: 'Café Central', estado: 'TRIAL', creadoEn: new Date('2026-01-01') },
  { id: 'd', nombre: 'Descomunal', estado: 'SUSPENDED', creadoEn: new Date('2026-01-01') },
  { id: 'e', nombre: 'Empanadas', estado: 'ACTIVE', creadoEn: new Date('2026-01-01') },
];

type Evento = { tenantId: string; en: Date; valor: number };

/**
 * Eventos de prueba, con trampas a propósito: justo antes y justo después de la
 * medianoche de Bogotá (05:00 UTC), en el borde del rango y en el hueco entre
 * «este mes» y su período anterior.
 */
function eventos(): Evento[] {
  const out: Evento[] = [];
  const instantes = [
    '2026-10-19T04:59:59Z', // 18 oct, 11:59 p. m. en Bogotá
    '2026-10-19T05:00:00Z', // 19 oct, medianoche
    '2026-10-01T05:00:00Z', // 1 oct, primer instante de «este mes»
    '2026-10-01T04:59:59Z', // 30 sep: hueco con «este mes», dentro de «30 días»
    '2026-09-20T05:00:00Z',
    '2026-09-19T12:00:00Z', // en el período anterior de «este mes»
    '2026-09-01T05:00:00Z',
    '2026-08-31T23:00:00Z', // 31 ago en Bogotá
    '2026-08-21T06:00:00Z',
    '2026-07-15T15:00:00Z',
    '2026-10-20T04:59:59Z', // 19 oct, 11:59 p. m. — último instante de hoy
  ];
  NEGOCIOS.forEach((neg, i) => {
    instantes.forEach((t, j) => {
      // `valor` decimal a veces: los sellos son SUM(amount), un Decimal.
      if ((i + j) % 4 !== 3) out.push({ tenantId: neg.id, en: new Date(t), valor: ((i + 1) * (j + 2)) / (j % 3 === 0 ? 2 : 1) });
    });
  });
  // Un negocio sin nada en ninguno de los dos períodos.
  out.push({ tenantId: 'e', en: new Date('2025-01-01T12:00:00Z'), valor: 9 });
  return out;
}

/** Lo que hace el SQL de `generales`: agrupar SOLO por día de Bogotá. */
function serieDeGenerales(ev: Evento[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ev) m.set(diaBogotaDe(e.en), (m.get(diaBogotaDe(e.en)) ?? 0) + e.valor);
  return m;
}

/** Lo que hace el SQL del desglose: agrupar por (negocio, día de Bogotá), con la fecha como `Date`. */
function filasDelDesglose(ev: Evento[]) {
  const m = new Map<string, { tenantId: string; dia: Date; valor: number }>();
  for (const e of ev) {
    const dia = diaBogotaDe(e.en);
    const k = `${e.tenantId}|${dia}`;
    const f = m.get(k) ?? { tenantId: e.tenantId, dia: new Date(`${dia}T00:00:00Z`), valor: 0 };
    f.valor += e.valor;
    m.set(k, f);
  }
  return [...m.values()];
}

function dentroDeVentana(ev: Evento[], preset: Preset) {
  const rango = rangoDePreset(preset, MEDIODIA);
  const anterior = periodoAnterior(rango, preset);
  const v = { gte: limitesUtc(anterior).gte, lt: limitesUtc(rango).lt };
  return { rango, anterior, ev: ev.filter((e) => e.en >= v.gte && e.en < v.lt) };
}

describe('el desglose cuadra con la tarjeta de generales', () => {
  // Una sola prueba cubre las métricas por día (pases, clientes, sellos,
  // canjes, pedidos, push, wallet): todas pasan por el mismo reparto, y lo que
  // cambia entre ellas es solo la columna que se suma.
  const presets: Preset[] = ['hoy', '7d', '30d', '90d', 'mes', 'mesAnterior'];
  for (const preset of presets) {
    it(`con «${preset}» la suma por negocio = el total y el anterior de la tarjeta`, () => {
      const { rango, anterior, ev } = dentroDeVentana(eventos(), preset);
      const serie = serieDeGenerales(ev);
      const tarjeta = { valor: sumaEnRango(serie, rango), anterior: sumaEnRango(serie, anterior) };

      const rep = repartirPorNegocio(filasDelDesglose(ev), ['valor'] as const, rango, anterior);
      const datos = new Map<string, EntradaNegocio>(
        [...rep].map(([id, a]) => [id, { valor: a.actual.valor, anterior: a.anterior.valor }]),
      );
      const tabla = armarTabla(NEGOCIOS, datos, []);

      // Si los datos de prueba no cayeran en el rango, el cuadre pasaría en
      // verde con 0 = 0 y no probaría nada.
      expect(tarjeta.valor).toBeGreaterThan(0);
      expect(tabla.totales.valor).toBeCloseTo(tarjeta.valor, 6);
      expect(tabla.totales.anterior).toBeCloseTo(tarjeta.anterior, 6);
      // Y la suma de las FILAS visibles también: los escondidos tienen 0.
      expect(tabla.filas.reduce((s, f) => s + f.valor, 0)).toBeCloseTo(tarjeta.valor, 6);
      expect(tabla.filas.reduce((s, f) => s + f.anterior, 0)).toBeCloseTo(tarjeta.anterior, 6);
    });
  }

  it('la prueba sabe ponerse en rojo: agrupar por día UTC descuadra «hoy»', () => {
    const { rango, anterior, ev } = dentroDeVentana(eventos(), 'hoy');
    const tarjeta = sumaEnRango(serieDeGenerales(ev), rango);
    const malas = ev.map((e) => ({ tenantId: e.tenantId, dia: e.en.toISOString().slice(0, 10), valor: e.valor }));
    const rep = repartirPorNegocio(malas, ['valor'] as const, rango, anterior);
    const total = [...rep.values()].reduce((s, a) => s + a.actual.valor, 0);
    expect(total).not.toBeCloseTo(tarjeta, 6);
  });

  it('las columnas extra sumables también cuadran (guardados de Apple y Google)', () => {
    const { rango, anterior, ev } = dentroDeVentana(eventos(), '30d');
    const filas = filasDelDesglose(ev).map((f, i) => ({ ...f, apple: i % 2, google: i % 3 === 0 ? 1 : 0 }));
    const rep = repartirPorNegocio(filas, ['valor', 'apple', 'google'] as const, rango, anterior);
    const datos = new Map<string, EntradaNegocio>(
      [...rep].map(([id, a]) => [
        id,
        { valor: a.actual.valor, anterior: a.anterior.valor, extra: { apple: a.actual.apple, google: a.actual.google, pct: 50 } },
      ]),
    );
    const tabla = armarTabla(NEGOCIOS, datos, [
      { clave: 'apple', etiqueta: 'Apple', tipo: 'numero' },
      { clave: 'google', etiqueta: 'Google', tipo: 'numero' },
      { clave: 'pct', etiqueta: '%', tipo: 'porcentaje' },
    ]);
    const esperadoApple = filas.filter((f) => f.dia.toISOString().slice(0, 10) >= rango.desde && f.dia.toISOString().slice(0, 10) <= rango.hasta).reduce((s, f) => s + f.apple, 0);
    expect(tabla.totales.extra.apple).toBe(esperadoApple);
    // Un % no se suma.
    expect(tabla.totales.extra.pct).toBeUndefined();
  });

  it('tarjetas: contar por instante en [gte, lt) = `card.count` de generales', () => {
    const { rango, anterior, ev } = dentroDeVentana(eventos(), 'mes');
    const cur = limitesUtc(rango);
    const prev = limitesUtc(anterior);
    // generales: dos `count` con los mismos límites.
    const tarjeta = {
      valor: ev.filter((e) => e.en >= cur.gte && e.en < cur.lt).length,
      anterior: ev.filter((e) => e.en >= prev.gte && e.en < prev.lt).length,
    };
    const datos = new Map<string, EntradaNegocio>();
    for (const e of ev) {
      const d = datos.get(e.tenantId) ?? { valor: 0, anterior: 0 };
      if (e.en >= cur.gte && e.en < cur.lt) d.valor += 1;
      else if (e.en >= prev.gte && e.en < prev.lt) d.anterior += 1;
      datos.set(e.tenantId, d);
    }
    const tabla = armarTabla(NEGOCIOS, datos, []);
    expect(tabla.totales.valor).toBe(tarjeta.valor);
    expect(tabla.totales.anterior).toBe(tarjeta.anterior);
  });

  it('uso: los que «usan» son los mismos que cuenta `clasificarUso`', () => {
    const conActividad = new Set(['a', 'e']);
    const activos = NEGOCIOS.filter((x) => x.estado === 'ACTIVE');
    const movimientos: Record<string, [number, number]> = { a: [3, 0], b: [0, 0], e: [0, 2] };
    let usan = 0;
    for (const x of activos) {
      const [m, p] = movimientos[x.id];
      if (m > 0 || p > 0) usan += 1;
    }
    expect(usan).toBe(clasificarUso(NEGOCIOS, conActividad).usan);
  });
});

describe('armarTabla', () => {
  it('de mayor a menor, empate por el anterior y luego por nombre; esconde a quien no tuvo nada', () => {
    const datos = new Map<string, EntradaNegocio>([
      ['a', { valor: 5, anterior: 1 }],
      ['b', { valor: 5, anterior: 4 }],
      ['c', { valor: 9, anterior: 0 }],
      ['d', { valor: 0, anterior: 0 }],
      ['e', { valor: 0, anterior: 3 }],
    ]);
    const t = armarTabla(NEGOCIOS, datos, []);
    expect(t.filas.map((f) => f.id)).toEqual(['c', 'b', 'a', 'e']);
    expect(t.sinMovimiento).toBe(1);
    expect(t.filas[0].variacion.tendencia).toBe('nuevo');
  });

  it('`mostrar` deja ver al que solo tuvo cancelados', () => {
    const datos = new Map<string, EntradaNegocio>([['a', { valor: 0, anterior: 0, extra: { cancelados: 2 } }]]);
    const t = armarTabla(NEGOCIOS, datos, [], { mostrar: (d) => Number(d.extra?.cancelados) > 0 });
    expect(t.filas.map((f) => f.id)).toEqual(['a']);
  });
});

describe('canjes por tipo de tarjeta', () => {
  it('manda `redeemKind`: un cupón transformado en sellos sigue siendo cupón', () => {
    expect(tipoDeCanje('COUPON', 'STAMPS')).toBe('COUPON');
    expect(tipoDeCanje('REWARD', 'STAMPS')).toBe('STAMPS');
    expect(tipoDeCanje('REWARD', 'VISITS')).toBe('VISITS');
    expect(tipoDeCanje('REWARD', 'POINTS')).toBe('POINTS');
    expect(tipoDeCanje('REWARD', 'CASHBACK')).toBe('CASHBACK');
    expect(tipoDeCanje('REWARD', 'HYBRID')).toBe('OTRO');
    // Sin clasificar (copias del duplicador): cae al tipo de la tarjeta.
    expect(tipoDeCanje(null, 'GIFT')).toBe('COUPON');
    expect(tipoDeCanje(null, 'STAMPS')).toBe('STAMPS');
    expect(tipoDeCanje(null, null)).toBe('OTRO');
  });

  const filas: FilaCanje[] = [
    { tenantId: 'a', redeemKind: 'REWARD', cardId: 'k1', cardName: 'Café', cardType: 'STAMPS', canjes: 500 },
    { tenantId: 'a', redeemKind: 'COUPON', cardId: 'k1', cardName: 'Café', cardType: 'STAMPS', canjes: 120 },
    { tenantId: 'b', redeemKind: 'COUPON', cardId: 'k2', cardName: 'Bienvenida', cardType: 'COUPON', canjes: 30 },
    { tenantId: 'b', redeemKind: 'REWARD', cardId: 'k3', cardName: 'Cortes', cardType: 'VISITS', canjes: 50 },
    { tenantId: 'c', redeemKind: 'REWARD', cardId: 'k4', cardName: 'Puntos', cardType: 'POINTS', canjes: 7 },
    { tenantId: 'c', redeemKind: null, cardId: 'k5', cardName: 'Copia', cardType: 'STAMPS', canjes: 1 },
  ];

  it('el resumen por tipo suma el total y lo dice en una frase', () => {
    const r = resumirCanjes(filas);
    expect(r.total).toBe(708);
    expect(r.porTipo.reduce((s, t) => s + t.canjes, 0)).toBe(r.total);
    expect(r.porTipo.map((t) => [t.tipo, t.canjes])).toEqual([
      ['STAMPS', 501],
      ['VISITS', 50],
      ['COUPON', 150],
      ['POINTS', 7],
    ]);
    expect(r.sinClasificar).toBe(1);
    expect(r.frase).toBe(
      'De los 708 canjes: 501 premios de tarjeta de sellos completada, 50 premios de tarjeta de visitas completada, 150 cupones canjeados y 7 canjes en tarjetas de puntos.',
    );
  });

  it('por tarjeta: los cupones de un pase transformado no se mezclan con los premios de esa tarjeta', () => {
    const r = resumirCanjes(filas);
    const cafe = r.porTarjeta.filter((t) => t.cardId === 'k1');
    expect(cafe).toHaveLength(2);
    expect(cafe.find((t) => t.tipo === 'COUPON')).toMatchObject({ canjes: 120, tarjetaTransformada: true });
    expect(cafe.find((t) => t.tipo === 'STAMPS')).toMatchObject({ canjes: 500, tarjetaTransformada: false });
    expect(r.porTarjeta.find((t) => t.cardId === 'k2')?.tarjetaTransformada).toBe(false);
    expect(r.porTarjeta.reduce((s, t) => s + t.canjes, 0)).toBe(708);
  });

  it('por negocio: las columnas de tipo suman los canjes del negocio', () => {
    const m = canjesPorTipoDelNegocio(filas);
    const a = m.get('a')!;
    expect(a.STAMPS + a.COUPON).toBe(620);
    expect(m.get('b')).toMatchObject({ COUPON: 30, VISITS: 50 });
  });

  it('sin canjes no inventa partes', () => {
    expect(resumirCanjes([]).frase).toBe('No hubo canjes en el rango.');
    expect(resumirCanjes([{ ...filas[0], canjes: 1 }]).frase).toBe('Hubo 1 canje: 1 premio de tarjeta de sellos completada.');
  });
});
