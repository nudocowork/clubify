import { describe, it, expect } from 'vitest';
import { StripeService } from './stripe.service';

/**
 * El crédito de la marca cuando a un negocio lo activa un PAGO.
 *
 * EL FALLO (2026-09-14, Humberto): «el crédito no se descuenta en las cuentas
 * demo cuando pasan de prueba a plan pagado». Medido en producción: «demo demo»
 * (Sellea) pagó $80 por Stripe el 6 de septiembre y a Sellea no se le descontó
 * nada; la marca lleva sin consumir un crédito por esta vía desde que existe.
 *
 * La causa: el cobro de este camino vivía en `consumeTrialConversionCredit`, y
 * su primera condición es saber que la suscripción tuvo prueba — dato que sale
 * de PREGUNTARLE A STRIPE por la suscripción. La `secretKey` que Sellea tiene
 * guardada es un Destination ID (`ed_…`) en vez de una `sk_live_…`, así que esa
 * llamada devuelve 401, el error se traga con un `warn`, y el crédito no se
 * cobraba nunca.
 *
 * Ahora el disparador es la transición a ACTIVE, que es un hecho de nuestra
 * base y no depende de que la pasarela conteste. Estas pruebas cubren eso y las
 * dos cosas que no se pueden romper al hacerlo:
 *   · un pago NO puede quedar sin servicio porque la marca no tenga créditos;
 *   · una sola compra dispara TRES eventos de Stripe y no puede costar tres.
 */

type Negocio = {
  id: string;
  brandName: string;
  status: string;
  planPeriodicity: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  whiteLabelId: string | null;
  businessType: string | null;
  infolinkTier: string | null;
  purchasedAt?: Date | null;
};

const NEGOCIO: Negocio = {
  id: 't1',
  brandName: 'demo demo',
  status: 'TRIAL',
  planPeriodicity: 'MENSUAL',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: null,
  whiteLabelId: 'wl-sellea',
  businessType: 'FULL',
  infolinkTier: null,
};

const LINKS = [
  { periodicity: 'MENSUAL', amountUsd: 80, active: true, productKey: null, stripePriceId: null },
  { periodicity: 'ANUAL', amountUsd: 799, active: true, productKey: null, stripePriceId: null },
];

function banco(opts: { creditos: number; ilimitada?: boolean; slug?: string }) {
  const marca = {
    id: 'wl-sellea',
    slug: opts.slug ?? 'sellea',
    creditsUnlimited: !!opts.ilimitada,
    creditsAvailable: opts.creditos,
    creditsUsed: 0,
  };
  // `fila` es la fila de la base; lo que se le pasa a `activate` es una COPIA,
  // como en producción (ahí el objeto sale de un `findFirst`, no es la fila
  // viva). Si fueran el mismo objeto, el reclamo de la transición le cambiaría
  // el estado en la mano al cobro y la prueba mentiría.
  const fila: Negocio = { ...NEGOCIO };
  const movimientos: any[] = [];

  const prisma: any = {
    tenant: {
      // El reclamo de la transición y el del período comparten esta puerta:
      // solo pasa el primero que llega, que es justo lo que se prueba.
      updateMany: async ({ where, data }: any) => {
        if (where.status?.not && fila.status === where.status.not) return { count: 0 };
        if (where.OR) {
          const mismo =
            fila.currentPeriodEnd &&
            data.currentPeriodEnd &&
            fila.currentPeriodEnd.getTime() === data.currentPeriodEnd.getTime();
          if (mismo) return { count: 0 };
        }
        Object.assign(fila, data);
        return { count: 1 };
      },
      findUnique: async () => ({ purchasedAt: fila.purchasedAt ?? null }),
      update: async ({ data }: any) => {
        Object.assign(fila, data);
        return fila;
      },
    },
    whiteLabel: {
      findUnique: async () => ({
        id: marca.id,
        slug: marca.slug,
        creditsUnlimited: marca.creditsUnlimited,
      }),
      updateMany: async ({ where, data }: any) => {
        const minimo = where.creditsAvailable?.gte ?? 0;
        if (marca.creditsAvailable < minimo) return { count: 0 };
        marca.creditsAvailable -= data.creditsAvailable.decrement;
        marca.creditsUsed += data.creditsUsed.increment;
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        marca.creditsAvailable += data.creditsAvailable.increment;
        marca.creditsUsed -= data.creditsUsed.decrement;
        return marca;
      },
    },
    creditTransaction: {
      create: async ({ data }: any) => {
        movimientos.push(data);
        return data;
      },
    },
    whiteLabelPaymentLink: {
      findFirst: async ({ where }: any) =>
        LINKS.find((l) => l.stripePriceId === where.stripePriceId) ?? null,
      findMany: async ({ where }: any) =>
        LINKS.filter(
          (l) => l.active && l.productKey === null && Number(l.amountUsd) === Number(where.amountUsd),
        ),
    },
  };

  const srv = Object.create(StripeService.prototype) as any;
  srv.prisma = prisma;
  srv.logger = { log: () => {}, warn: () => {}, error: () => {} };
  srv.incomeRecord = { record: async () => {} };
  srv.hotmart = { generarComisionesDeCobro: async () => {} };
  srv.billing = { clearCreditRelease: async () => {}, auditLifecycle: async () => {} };
  srv.smsTemplates = { render: async () => 'sms' };
  srv.brandEmail = { sendTemplate: async () => {} };
  srv.onboardingWebhook = { emitBusinessActivated: () => {} };
  // notifyOwner llama a la pasarela de SMS; acá no interesa.
  srv.notifyOwner = async () => {};

  return { srv, marca, fila, movimientos };
}

/** El contexto que arma `extractCtx`. `trialEnd: null` es el caso REAL de
 *  Sellea: con la clave inválida, Stripe nunca contesta quién tuvo prueba. */
function cobro(over: Partial<Record<string, unknown>> = {}) {
  return {
    email: 'demo@ejemplo.com',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    priceId: null,
    nextCharge: new Date('2026-10-06T21:39:00Z'),
    amountUsd: 80,
    paidAt: new Date('2026-09-06T22:40:00Z'),
    trialEnd: null,
    transaccionId: 'in_1',
    ...over,
  } as any;
}

/** Le entrega a `activate` una COPIA de la fila, como el webhook real. */
const activar = (srv: any, fila: Negocio, ctx: any) =>
  srv.activate({ ...fila }, ctx, 'wl-sellea');

describe('el crédito de la marca al activar por pago', () => {
  it('la conversión de prueba a pagado consume el crédito, sin preguntarle a Stripe', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 3 });
    await activar(srv, fila, cobro());
    expect(marca.creditsAvailable).toBe(2);
    expect(marca.creditsUsed).toBe(1);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].type).toBe('CONSUME');
    expect(movimientos[0].amount).toBe(-1);
    expect(movimientos[0].tenantId).toBe('t1');
    expect(movimientos[0].note).toContain('pago Stripe');
  });

  it('durante la PRUEBA no cobra: el día 0 no entró dinero', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 3 });
    const enPrueba = cobro({
      trialEnd: new Date(Date.now() + 7 * 86_400_000),
      amountUsd: 0,
    });
    await activar(srv, fila, enPrueba);
    expect(fila.status).toBe('TRIAL');
    expect(marca.creditsAvailable).toBe(3);
    expect(movimientos).toHaveLength(0);
  });

  it('una RENOVACIÓN de un negocio ya activo no vuelve a cobrar', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 3 });
    fila.status = 'ACTIVE';
    await activar(srv, fila, cobro());
    expect(marca.creditsAvailable).toBe(3);
    expect(movimientos).toHaveLength(0);
  });

  it('los TRES eventos de una misma compra cuestan UN crédito, no tres', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 3 });
    // checkout.session.completed + invoice.paid + invoice.payment_succeeded
    // llegan en el mismo segundo y los tres leen el estado viejo.
    await Promise.all([
      activar(srv, fila, cobro()),
      activar(srv, fila, cobro()),
      activar(srv, fila, cobro()),
    ]);
    expect(marca.creditsAvailable).toBe(2);
    expect(movimientos.filter((m) => m.type === 'CONSUME')).toHaveLength(1);
  });

  it('sin créditos en la marca, el que pagó SE ACTIVA igual y queda la deuda anotada', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 0 });
    await activar(srv, fila, cobro());
    expect(fila.status).toBe('ACTIVE');
    expect(marca.creditsAvailable).toBe(0);
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].type).toBe('ADJUSTMENT');
    expect(movimientos[0].amount).toBe(0);
    expect(movimientos[0].note).toContain('SIN CRÉDITOS');
  });

  it('un plan ANUAL cuesta 12 créditos aunque el negocio llegue sin periodicidad', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 20 });
    fila.planPeriodicity = null;
    await activar(srv, fila, cobro({ amountUsd: 799 }));
    expect(marca.creditsAvailable).toBe(8);
    expect(movimientos[0].amount).toBe(-12);
    // Y de paso se le guarda la periodicidad que compró.
    expect(fila.planPeriodicity).toBe('ANUAL');
  });

  it('Clubify no gasta créditos: su cobro va por Hotmart', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 3, slug: 'clubify' });
    await activar(srv, fila, cobro());
    expect(fila.status).toBe('ACTIVE');
    expect(marca.creditsAvailable).toBe(3);
    expect(movimientos).toHaveLength(0);
  });

  it('una marca con créditos ilimitados se activa sin consumir ni anotar', async () => {
    const { srv, marca, fila, movimientos } = banco({ creditos: 0, ilimitada: true });
    await activar(srv, fila, cobro());
    expect(fila.status).toBe('ACTIVE');
    expect(marca.creditsAvailable).toBe(0);
    expect(movimientos).toHaveLength(0);
  });
});
