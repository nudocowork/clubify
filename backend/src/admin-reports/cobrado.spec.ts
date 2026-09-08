import { describe, it, expect } from 'vitest';
import { calcularCobrado, type PeriodKey } from './cobrado';

/**
 * La cifra grande del panel de administración.
 *
 * El caso que abre estas pruebas es el de septiembre de 2026 medido contra
 * producción: el panel decía $1.454,52 y habían entrado $917,52. Un 58% de
 * más, en el número que se mira para saber cómo va el mes.
 */

const PRECIOS: Record<PeriodKey, number> = {
  MENSUAL: 50,
  TRIMESTRAL: 135,
  SEMESTRAL: 255,
  ANUAL: 480,
};

const base = {
  wlId: null as string | null,
  normalizePeriod: (p: string | null): PeriodKey =>
    p && p in PRECIOS ? (p as PeriodKey) : 'MENSUAL',
  precioDeLista: (t: { planPeriodicity: string | null; subscriptionPriceUsd: unknown }) => {
    const real = Number(t.subscriptionPriceUsd);
    return Number.isFinite(real) && real > 0
      ? real
      : PRECIOS[(t.planPeriodicity as PeriodKey) ?? 'MENSUAL'] ?? 50;
  },
  precioCanonico: (k: PeriodKey) => PRECIOS[k],
};

const negocio = (id: string, per = 'MENSUAL', precio: number | null = null) => ({
  id,
  planPeriodicity: per,
  subscriptionPriceUsd: precio,
});
const ingreso = (tenantId: string | null, usd: number, per = 'MENSUAL') => ({
  tenantId,
  whiteLabelId: null,
  grossUsd: usd,
  planPeriodicity: per,
});

function calc(x: Partial<Parameters<typeof calcularCobrado>[0]>) {
  return calcularCobrado({
    ingresos: [],
    negociosConFecha: [],
    gruposConFecha: [],
    negociosEnAlcance: [],
    ...base,
    ...x,
  } as Parameters<typeof calcularCobrado>[0]);
}

describe('cobrado · el caso real de septiembre 2026', () => {
  // Lo que de verdad pasó, tal cual salió de producción.
  const enAlcance = [
    'wok', 'konys', 'hydor', 'segundo', 'ncoffee',
    'jeank', 'cocoa', 'cacerola', 'demo', 'quipao',
    'moa', 'cookies',
  ].map((id) => ({ id, planPeriodicity: 'MENSUAL' }));

  const ingresos = [
    ingreso('wok', 50), ingreso('konys', 50), ingreso('hydor', 50),
    ingreso('segundo', 150, 'TRIMESTRAL'), ingreso('ncoffee', 135, 'TRIMESTRAL'),
    ingreso('jeank', 68), ingreso('cocoa', 135, 'TRIMESTRAL'),
    ingreso('cacerola', 150, 'TRIMESTRAL'), ingreso('demo', 80),
    ingreso('quipao', 49.52),
  ];

  // Los 12 que el panel contaba: los 10 de arriba + los dos fantasmas.
  const conFecha = [
    negocio('wok'), negocio('konys'), negocio('hydor'),
    negocio('segundo', 'TRIMESTRAL'), negocio('ncoffee', 'TRIMESTRAL'),
    negocio('jeank'), negocio('cocoa', 'TRIMESTRAL'),
    negocio('cacerola', 'TRIMESTRAL'), negocio('demo'),
    negocio('quipao', 'MENSUAL', 49.52),
    negocio('moa', 'ANUAL'), negocio('cookies', 'TRIMESTRAL'),
  ];

  it('suma el dinero que entró, no el precio de lista', () => {
    const r = calc({ ingresos, negociosConFecha: conFecha, negociosEnAlcance: enAlcance });
    expect(r.cobradoUsd).toBe(917.52);
  });

  it('no cuenta como caja los dos cobros sin transacción', () => {
    const r = calc({ ingresos, negociosConFecha: conFecha, negociosEnAlcance: enAlcance });
    // Moa Café ANUAL $480 + Oh! Cookies TRIMESTRAL $135.
    expect(r.sinRegistrarUsd).toBe(615);
    expect(r.sinRegistrarCount).toBe(2);
  });

  it('nada se pierde: los 12 negocios siguen contados, en un lado o en otro', () => {
    const r = calc({ ingresos, negociosConFecha: conFecha, negociosEnAlcance: enAlcance });
    // 10 con transacción real + 2 sin ella. El panel antes los metía a los 12
    // en la misma cifra, y por eso decía $1.454,52.
    expect(r.porPlan.MENSUAL.count + r.porPlan.TRIMESTRAL.count).toBe(10);
    expect(r.sinRegistrarCount).toBe(2);
  });

  it('el que pagó más de lo que dice su plan cuenta lo que pagó', () => {
    const r = calc({
      ingresos: [ingreso('segundo', 150, 'TRIMESTRAL')],
      negociosConFecha: [negocio('segundo', 'TRIMESTRAL')],
      negociosEnAlcance: [{ id: 'segundo', planPeriodicity: 'TRIMESTRAL' }],
    });
    expect(r.cobradoUsd).toBe(150); // el precio de lista era 135
    expect(r.sinRegistrarUsd).toBe(0);
  });
});

describe('cobrado · los bordes', () => {
  it('un negocio que pagó DOS veces en el rango suma las dos', () => {
    const r = calc({
      ingresos: [ingreso('a', 50), ingreso('a', 50)],
      negociosConFecha: [negocio('a')],
      negociosEnAlcance: [{ id: 'a', planPeriodicity: 'MENSUAL' }],
    });
    // Antes contaba el negocio UNA vez, al precio de su plan: $50.
    expect(r.cobradoUsd).toBe(100);
  });

  it('el dinero de otra marca no entra', () => {
    const r = calc({
      ingresos: [ingreso('mio', 50), ingreso('ajeno', 999)],
      negociosEnAlcance: [{ id: 'mio', planPeriodicity: 'MENSUAL' }],
    });
    expect(r.cobradoUsd).toBe(50);
  });

  it('un ingreso sin negocio entra solo si es de la marca que se mira', () => {
    const suelto = { tenantId: null, whiteLabelId: 'marca-a', grossUsd: 70, planPeriodicity: null };
    expect(calc({ ingresos: [suelto], wlId: 'marca-a' }).cobradoUsd).toBe(70);
    expect(calc({ ingresos: [suelto], wlId: 'marca-b' }).cobradoUsd).toBe(0);
    expect(calc({ ingresos: [suelto], wlId: null }).cobradoUsd).toBe(70);
  });

  it('un grupo cuyo negocio pagó NO se cuenta otra vez', () => {
    const r = calc({
      ingresos: [ingreso('miembro', 150)],
      negociosEnAlcance: [{ id: 'miembro', planPeriodicity: 'MENSUAL' }],
      gruposConFecha: [
        { planPeriodicity: 'MENSUAL', priceUsd: 150, tenants: [{ id: 'miembro' }] },
      ],
    });
    expect(r.cobradoUsd).toBe(150); // no 300
    expect(r.sinRegistrarUsd).toBe(0);
    expect(r.porPlan.MENSUAL.groups).toBe(1); // pero sí es un grupo, no un negocio
  });

  it('un grupo sin ninguna transacción va a «sin registrar», no a caja', () => {
    const r = calc({
      gruposConFecha: [
        { planPeriodicity: 'MENSUAL', priceUsd: 150, tenants: [{ id: 'x' }] },
      ],
    });
    expect(r.cobradoUsd).toBe(0);
    expect(r.sinRegistrarUsd).toBe(150);
    expect(r.porPlan.MENSUAL.groups).toBe(0); // no cobró: no es una unidad de caja
  });

  it('un importe corrupto no envenena la suma', () => {
    const r = calc({
      ingresos: [
        ingreso('a', 50),
        { tenantId: 'a', whiteLabelId: null, grossUsd: 'no soy un número', planPeriodicity: null },
      ],
      negociosEnAlcance: [{ id: 'a', planPeriodicity: 'MENSUAL' }],
    });
    expect(r.cobradoUsd).toBe(50);
  });

  it('sin nada en el rango, todo a cero', () => {
    const r = calc({});
    expect(r.cobradoUsd).toBe(0);
    expect(r.sinRegistrarUsd).toBe(0);
    expect(r.sinRegistrarCount).toBe(0);
  });

  it('los céntimos no se van en decimales largos', () => {
    const r = calc({
      ingresos: [ingreso('a', 49.52), ingreso('a', 0.1), ingreso('a', 0.2)],
      negociosEnAlcance: [{ id: 'a', planPeriodicity: 'MENSUAL' }],
    });
    expect(r.cobradoUsd).toBe(49.82);
  });
});
