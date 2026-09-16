import { describe, it, expect } from 'vitest';
import { CobrosService } from './cobros.service';

/**
 * «Próximos cobros» (Contabilidad y dashboard) tiene que mostrar TAMBIÉN a los
 * negocios que pagan POR FUERA de las pasarelas (Tenant.manualPayment).
 *
 * POR QUÉ ESTA PRUEBA (2026-09-16, pregunta del dueño): no había forma de
 * verificarlo a ojo en producción —los meses en que ningún pago manual vence
 * dentro de la ventana, la lista sale igual con o sin el descarte—, así que un
 * filtro por forma de pago podría colarse sin que nadie lo notara hasta el mes
 * siguiente. `CobrosService` NO filtra por `manualPayment`, `paymentGateway` ni
 * por tener `hotmartSubscriberCode`: clasifica a todos con `deriveRenewalState`
 * y solo distingue la forma de pago en la columna «Método». Esto lo fija.
 *
 * Los datos imitan casos reales de producción (Empanadas La Parada, que vence
 * el 2026-09-23 pagando por Nequi/transferencia).
 */

const AHORA = new Date('2026-09-16T12:00:00Z');

const negocio = (p: Record<string, any> = {}) => ({
  id: p.id ?? 't-manual',
  brandName: p.brandName ?? 'Empanadas La Parada',
  // Campos del `where` del servicio: sin ellos el doble no podría comprobar el
  // filtro de la consulta, que es justo por donde se escaparían los manuales.
  isCampaignHost: false,
  businessGroupId: null,
  deletedAt: null,
  whiteLabelId: p.whiteLabelId ?? null,
  status: p.status ?? 'ACTIVE',
  planPeriodicity: p.planPeriodicity ?? 'TRIMESTRAL',
  subscriptionPriceUsd: p.subscriptionPriceUsd ?? null,
  currentPeriodEnd: p.currentPeriodEnd ?? new Date('2026-09-23T00:00:00Z'),
  firstFailedAt: p.firstFailedAt ?? null,
  lastPaymentAttemptAt: p.lastPaymentAttemptAt ?? null,
  lastChargeAt: p.lastChargeAt ?? new Date('2026-06-23T00:00:00Z'),
  failedPaymentCount: p.failedPaymentCount ?? 0,
  suspendedAt: p.suspendedAt ?? null,
  manualPayment: p.manualPayment ?? true,
  stripeSubscriptionId: p.stripeSubscriptionId ?? null,
});

/**
 * Aplica las igualdades del `where` de Prisma. Un doble que devuelve las filas
 * tal cual NO puede ponerse en rojo si alguien añade `manualPayment: false` a la
 * consulta —el descarte más probable—, y la prueba daría verde sin mirar nada.
 */
function cumpleWhere(fila: any, where: any = {}): boolean {
  return Object.entries(where).every(([campo, valor]) => {
    // Operadores (`{ gte }`, `{ in }`…): fuera del alcance de este doble.
    if (valor !== null && typeof valor === 'object' && !(valor instanceof Date)) {
      return true;
    }
    return (fila[campo] ?? null) === valor;
  });
}

/** Prisma de mentira: solo lo que `CobrosService` consulta. */
function prismaFalso(negocios: any[]) {
  return {
    setting: {
      findUnique: async ({ where }: any) =>
        where.key === 'billing.graceDays' ? { value: '5' } : null,
    },
    tenant: {
      findMany: async ({ where }: any = {}) =>
        negocios.filter((t) => cumpleWhere(t, where)),
    },
    businessGroup: { findMany: async () => [] },
    incomeRecord: {
      aggregate: async () => ({ _count: { _all: 0 }, _sum: { grossUsd: 0 } }),
    },
  } as any;
}

const servicio = (negocios: any[]) => new CobrosService(prismaFalso(negocios));

describe('Próximos cobros — los pagos manuales cuentan igual que los demás', () => {
  it('un negocio de pago por fuera con el ciclo dentro de la ventana SALE, marcado «Pago por fuera»', async () => {
    const filas: any[] = await servicio([negocio()]).detail(
      null,
      'proximos',
      AHORA,
      { days: 30 },
    );

    expect(filas).toHaveLength(1);
    expect(filas[0].negocio).toBe('Empanadas La Parada');
    expect(filas[0].metodo).toBe('Pago por fuera');
    // Sin precio pactado cae al canónico de su periodicidad (TRIMESTRAL = 150):
    // un monto en 0 lo dejaría invisible en la suma aunque saliera en la tabla.
    expect(filas[0].montoUsd).toBe(150);
  });

  it('sale UNA sola vez: el pago manual no duplica la fila', async () => {
    const filas: any[] = await servicio([
      negocio(),
      negocio({ id: 't-hotmart', brandName: 'Paga con Hotmart', manualPayment: false }),
    ]).detail(null, 'proximos', AHORA, { days: 30 });

    expect(filas).toHaveLength(2);
    expect(filas.filter((f) => f.negocio === 'Empanadas La Parada')).toHaveLength(1);
    expect(filas.map((f) => f.metodo).sort()).toEqual(['Hotmart', 'Pago por fuera']);
  });

  it('cuenta en el resumen (la tarjeta «Por cobrar»), no solo en la tabla', async () => {
    const resumen = await servicio([
      negocio({ currentPeriodEnd: new Date('2026-09-20T00:00:00Z') }),
    ]).summary(null, AHORA);

    expect(resumen.proximos.count).toBe(1);
    expect(resumen.proximos.amountUsd).toBe(150);
  });

  it('un manual suspendido o cancelado NO se cuela en próximos cobros', async () => {
    const filas: any[] = await servicio([
      negocio({ id: 't-susp', brandName: 'Suspendido', status: 'SUSPENDED' }),
      negocio({ id: 't-canc', brandName: 'Cancelado', status: 'CANCELED' }),
    ]).detail(null, 'proximos', AHORA, { days: 30 });

    expect(filas).toHaveLength(0);
  });

  it('un manual con el ciclo lejos NO aparece en la ventana corta, pero sí en la larga', async () => {
    const lejos = [negocio({ currentPeriodEnd: new Date('2026-11-05T00:00:00Z') })];

    expect(await servicio(lejos).detail(null, 'proximos', AHORA, { days: 30 })).toHaveLength(0);
    expect(await servicio(lejos).detail(null, 'proximos', AHORA, { days: 60 })).toHaveLength(1);
  });
});
