import { describe, it, expect } from 'vitest';
import { StripeService } from './stripe.service';

/**
 * Qué periodicidad se le apunta a un negocio cuando paga por Stripe.
 *
 * EL FALLO (2026-09-14, Humberto en Sellea): «cuando voy a asignarle plan a
 * alguien no le carga». Smart Solutions pagó $80 por Stripe el 9 de
 * septiembre y el panel seguía diciendo «Plan: Sin definir».
 *
 * Eran dos cosas:
 *
 *  1. `resolvePeriodicity` SÍ sacaba la periodicidad del link de pago… y solo
 *     la usaba para calcular la fecha del próximo cobro. Nunca se guardaba en
 *     el negocio.
 *  2. Y aun guardándola, no habría resuelto: los links reales de Sellea
 *     —Mensual $80 y Anual $799— **no tienen `stripePriceId`**. El único que
 *     lo tiene es el añadido «InfoLink PRO». De ahí el segundo camino, por
 *     importe.
 *
 * La regla que no se puede romper: si dos links casan por importe, NO se
 * elige. Adivinar entre dos planes deja el error escrito en la base.
 */

const LINKS_SELLEA = [
  { periodicity: 'MENSUAL', amountUsd: 80, active: true, productKey: null, stripePriceId: null },
  { periodicity: 'ANUAL', amountUsd: 799, active: true, productKey: null, stripePriceId: null },
  { periodicity: 'MENSUAL', amountUsd: 14.99, active: true, productKey: 'INFOLINK_PRO', stripePriceId: 'price_infolink' },
  { periodicity: 'CUSTOM', amountUsd: 60, active: false, productKey: null, stripePriceId: null },
];

function servicio(links = LINKS_SELLEA) {
  const prisma: any = {
    whiteLabelPaymentLink: {
      findFirst: async ({ where }: any) =>
        links.find((l) => l.stripePriceId === where.stripePriceId) ?? null,
      findMany: async ({ where }: any) =>
        links.filter(
          (l) =>
            l.active === true &&
            l.productKey === null &&
            Number(l.amountUsd) === Number(where.amountUsd),
        ),
    },
  };
  const srv = Object.create(StripeService.prototype) as any;
  srv.prisma = prisma;
  return srv;
}

const resolver = (
  srv: any,
  priceId: string | null,
  fallback: string | null,
  amountUsd?: number | null,
) => srv.resolvePeriodicity('wl-sellea', priceId, fallback, amountUsd);

describe('la periodicidad que compró el cliente', () => {
  it('la saca del stripePriceId cuando el link lo tiene', async () => {
    const r = await resolver(servicio(), 'price_infolink', null, 14.99);
    expect(r).toBe('MENSUAL');
  });

  it('sin stripePriceId, la saca del IMPORTE — el caso de Sellea', async () => {
    // Los links de $80 y $799 no tienen priceId guardado.
    expect(await resolver(servicio(), null, null, 80)).toBe('MENSUAL');
    expect(await resolver(servicio(), null, null, 799)).toBe('ANUAL');
  });

  it('un importe que no casa con ningún plan no inventa nada', async () => {
    expect(await resolver(servicio(), null, null, 123)).toBeNull();
  });

  it('NO usa los añadidos para deducir el plan', async () => {
    // $14,99 es InfoLink PRO, que tiene productKey: no es un plan del negocio.
    expect(await resolver(servicio(), null, null, 14.99)).toBeNull();
  });

  it('NO usa los links apagados', async () => {
    expect(await resolver(servicio(), null, null, 60)).toBeNull();
  });

  it('con DOS planes del mismo importe no elige: prefiere no saber', async () => {
    const ambiguos = [
      { periodicity: 'MENSUAL', amountUsd: 80, active: true, productKey: null, stripePriceId: null },
      { periodicity: 'TRIMESTRAL', amountUsd: 80, active: true, productKey: null, stripePriceId: null },
    ];
    expect(await resolver(servicio(ambiguos), null, null, 80)).toBeNull();
  });

  it('si no resuelve, respeta lo que el negocio ya tenía', async () => {
    expect(await resolver(servicio(), null, 'SEMESTRAL', 123)).toBe('SEMESTRAL');
  });

  it('sin importe y sin priceId, tampoco se inventa', async () => {
    expect(await resolver(servicio(), null, null, null)).toBeNull();
    expect(await resolver(servicio(), null, null, 0)).toBeNull();
  });
});
