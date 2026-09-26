import { describe, it, expect } from 'vitest';
import { BillingService } from './billing.service';

/**
 * Lo que el panel necesita para avisar «cancelaste, sigues activo hasta X».
 *
 * Cancelar dejó de desconectar en el acto el 2026-09-23 (LICORES EL AMANECER
 * perdió tres días que ya había pagado), pero `getStatus` no devolvía nada de
 * la cancelación. Resultado: el negocio cancelaba, seguía viéndolo todo normal
 * y no tenía forma de saber hasta cuándo — que parece que la cancelación no se
 * guardó, y entonces la gente vuelve a darle.
 */

const FIN = new Date('2026-11-15T00:00:00.000Z');

function servicio(tenant: Record<string, unknown> | null) {
  const prisma: any = {
    tenant: { findUnique: async () => tenant },
    setting: { findUnique: async () => null },
  };
  return new BillingService(
    prisma, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
}

const NEGOCIO = {
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: FIN,
  suspendedAt: null,
  canceledAt: null,
  failedPaymentCount: 0,
  gracePeriodDays: null,
  firstFailedAt: null,
  lastPaymentAttemptAt: null,
  lastChargeAt: null,
  stripeSubscriptionId: null,
};

describe('el estado que lee el panel', () => {
  it('sin cancelar no dice nada: no hay aviso que pintar', async () => {
    const r = await servicio(NEGOCIO).getStatus('t1');
    expect(r.canceledAt).toBeNull();
    expect(r.canceladaHasta).toBeNull();
  });

  it('CANCELADA con días por delante: dice hasta cuándo', async () => {
    const r = await servicio({
      ...NEGOCIO,
      canceledAt: new Date('2026-09-26T10:00:00.000Z'),
    }).getStatus('t1');
    expect(r.canceladaHasta).toEqual(FIN);
    // Y sigue ACTIVA, que es el sentido del arreglo: no se le quita nada.
    expect(r.status).toBe('ACTIVE');
    expect(r.isActiveAccess).toBe(true);
  });

  it('SIN acceso ya, el aviso desaparece', async () => {
    // Vencido el período, el negocio está suspendido y el aviso correcto es el
    // de la suspensión. «Sigues activo hasta el 15 de noviembre» dicho en
    // diciembre no informa: engaña.
    const r = await servicio({
      ...NEGOCIO,
      status: 'SUSPENDED',
      canceledAt: new Date('2026-09-26T10:00:00.000Z'),
      suspendedAt: new Date('2026-11-16T00:00:00.000Z'),
    }).getStatus('t1');
    expect(r.isActiveAccess).toBe(false);
    expect(r.canceladaHasta).toBeNull();
    // El dato crudo sí se conserva: el panel de administración lo usa.
    expect(r.canceledAt).not.toBeNull();
  });

  it('en PRUEBA cancelada, el límite es el fin de la prueba', async () => {
    const finPrueba = new Date('2026-10-05T00:00:00.000Z');
    const r = await servicio({
      ...NEGOCIO,
      status: 'TRIAL',
      currentPeriodEnd: null,
      trialEndsAt: finPrueba,
      canceledAt: new Date('2026-09-26T10:00:00.000Z'),
    }).getStatus('t1');
    expect(r.canceladaHasta).toEqual(finPrueba);
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: sin `canceledAt` en el select no hay aviso', async () => {
    // Si alguien quita `canceledAt` del `select` de `getStatus`, llega
    // `undefined` y el aviso deja de pintarse en silencio — el panel no falla,
    // simplemente calla, que es el fallo original.
    const sinElCampo = { ...NEGOCIO } as any;
    delete sinElCampo.canceledAt;
    const r = await servicio(sinElCampo).getStatus('t1');
    expect(r.canceladaHasta).toBeNull();
  });
});
