import { describe, it, expect, vi } from 'vitest';
import { BillingService } from './billing.service';

/**
 * LICORES EL AMANECER, 2026-09-23.
 *
 * Pagó su trimestre hasta el 26. A las 14:00 recibió el SMS de «te cobramos en
 * 3 días», entró a su panel a las 14:07 y canceló la renovación a las 14:08.
 * El sistema lo suspendió EN EL ACTO y perdió los tres días que ya había
 * pagado — sin aviso y sin dejar rastro de quién lo había hecho.
 *
 * Cancelar avisa de que no se renueve; no renuncia a lo pagado.
 */

const AHORA = new Date('2026-09-23T14:08:48.000Z');

function servicio(negocio: Record<string, unknown> | null) {
  const escrito: any[] = [];
  const auditado: any[] = [];
  const prisma: any = {
    tenant: {
      findUnique: async () => negocio,
      update: async ({ where, data }: any) => {
        escrito.push({ where, data });
        return { ...negocio, ...data };
      },
    },
  };
  const audit: any = { log: (x: unknown) => auditado.push(x) };
  const svc = new BillingService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    audit,
    {} as any,
  );
  vi.setSystemTime(AHORA);
  return { svc, escrito, auditado };
}

const LICORES = {
  id: 't-licores',
  brandName: 'LICORES EL AMANECER',
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: new Date('2026-09-26T23:00:03.579Z'),
  failedPaymentCount: 0,
};

describe('el dueño cancela y le quedan días pagados', () => {
  it('NO se le suspende', async () => {
    const { svc, escrito } = servicio(LICORES);
    await svc.cancelSubscription('t-licores', 'ya no lo necesito');
    expect(escrito[0].data.status).toBeUndefined();
    expect(escrito[0].data.suspendedAt).toBeUndefined();
  });

  it('se marca la cancelación, para que el cron no intente renovarlo', async () => {
    const { svc, escrito } = servicio(LICORES);
    await svc.cancelSubscription('t-licores');
    expect(escrito[0].data.canceledAt).toBeInstanceOf(Date);
  });

  it('se le dice hasta cuándo tiene acceso', async () => {
    const { svc } = servicio(LICORES);
    const r = await svc.cancelSubscription('t-licores');
    expect(r.suspendedNow).toBe(false);
    expect(r.accessUntil?.toISOString()).toBe('2026-09-26T23:00:03.579Z');
  });

  it('queda rastro en la auditoría de quién y por qué', async () => {
    // Sin esto, la suspensión aparecía de la nada: no había forma de saber que
    // la había pedido el propio dueño.
    const { svc, auditado } = servicio(LICORES);
    await svc.cancelSubscription('t-licores', 'me mudo de local');
    expect(auditado[0]).toMatchObject({
      action: 'billing.canceled_by_owner',
      tenantId: 't-licores',
      metadata: { brandName: 'LICORES EL AMANECER', reason: 'me mudo de local', suspendedNow: false },
    });
  });
});

describe('el dueño cancela y NO le queda nada pagado', () => {
  it('con el período ya vencido, se desconecta', async () => {
    const { svc, escrito } = servicio({
      ...LICORES,
      currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    });
    const r = await svc.cancelSubscription('t-licores');
    expect(escrito[0].data.status).toBe('SUSPENDED');
    expect(r.suspendedNow).toBe(true);
  });

  it('con un cobro fallido detrás, se desconecta (caso VALMONT)', async () => {
    const { svc, escrito } = servicio({ ...LICORES, failedPaymentCount: 2 });
    await svc.cancelSubscription('t-licores');
    expect(escrito[0].data.status).toBe('SUSPENDED');
  });

  it('sin fecha de vencimiento, se desconecta', async () => {
    const { svc, escrito } = servicio({ ...LICORES, currentPeriodEnd: null, trialEndsAt: null });
    await svc.cancelSubscription('t-licores');
    expect(escrito[0].data.status).toBe('SUSPENDED');
  });
});
