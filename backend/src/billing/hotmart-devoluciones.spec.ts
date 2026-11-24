import { describe, it, expect, vi } from 'vitest';
import { HotmartService } from './hotmart.service';

/**
 * Lo que hace el aviso de Hotmart con un reembolso, un contracargo, una disputa
 * o una cancelación (Javier, 2026-11-23). La lógica de cada cosa vive en
 * `BillingService` (probada en `cancelacion-y-devolucion.spec.ts`); aquí se
 * prueba que el aviso llega a la puerta correcta con los datos correctos.
 */

const PROTEIN = {
  id: 't-protein',
  brandName: 'Protein Station',
  status: 'ACTIVE',
  hotmartSubscriberCode: 'BRW813M3',
  hotmartTransactionId: 'HP0032012122',
  currentPeriodEnd: new Date('2027-01-23T12:00:00.000Z'),
  firstFailedAt: null,
  failedPaymentCount: 0,
  manualPayment: false,
};

function montar() {
  const billing: any = {
    aplicarDevolucion: vi.fn(async () => ({ ingresoMarcado: true, comisiones: null, cancelacion: { desconectadoAhora: true } })),
    registrarCancelacion: vi.fn(async () => ({ desconectadoAhora: false, origen: 'CLIENTE_PASARELA', aviso: { resultado: 'no_aplica' } })),
    auditLifecycle: vi.fn(async () => null),
    notifyBillingTeam: vi.fn(async () => null),
  };
  const smsTemplates: any = { render: vi.fn(async () => 'texto') };
  const brandEmail: any = { sendTemplate: vi.fn(async () => null) };
  const prisma: any = { tenant: { update: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) } };
  const svc = new HotmartService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    billing,
    {} as any,
    {} as any,
    {} as any,
    smsTemplates,
    brandEmail,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  vi.spyOn(svc as any, 'churnReferral').mockImplementation(async () => null);
  vi.spyOn(svc as any, 'notifyReferralChain').mockImplementation(async () => null);
  vi.spyOn(svc as any, 'maybeSendAdminNotice').mockImplementation(async () => false);
  const evento = (event: string, tx?: string) =>
    (svc as any).runEventLogic(event, { ...PROTEIN }, {
      event,
      data: { purchase: { transaction: tx, approved_date: Date.UTC(2026, 9, 23, 13, 28, 48) } },
    });
  return { svc, billing, smsTemplates, brandEmail, prisma, evento };
}

describe('la DISPUTA es una devolución, no un cobro fallido', () => {
  it('va por la devolución completa, con su tipo', async () => {
    const { billing, evento } = montar();
    await evento('PURCHASE_PROTEST', 'HP0032012122');
    expect(billing.aplicarDevolucion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-protein', tx: 'HP0032012122', tipo: 'DISPUTA', gateway: 'HOTMART', esDelPeriodoActual: true }),
    );
  });

  it('ya NO le manda al cliente «tu pago falló» ni lo pone en mora', async () => {
    // Protein Station lo recibió el 23-11 a las 14:59 por una disputa.
    const { smsTemplates, prisma, evento } = montar();
    await evento('PURCHASE_PROTEST', 'HP0032012122');
    expect(smsTemplates.render).not.toHaveBeenCalledWith('payment_failed', expect.anything(), expect.anything());
    expect(prisma.tenant.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ failedPaymentCount: { increment: 1 } }) }),
    );
  });

  it('el correo es el de la disputa', async () => {
    const { brandEmail, evento } = montar();
    await evento('PURCHASE_PROTEST', 'HP0032012122');
    expect(brandEmail.sendTemplate).toHaveBeenCalledWith({ templateId: 'email_dispute', tenantId: 't-protein' });
  });
});

describe('reembolso y contracargo', () => {
  it('cada uno con su tipo', async () => {
    const { billing, evento } = montar();
    await evento('PURCHASE_REFUNDED', 'HP0032012122');
    await evento('PURCHASE_CHARGEBACK', 'HP0032012122');
    expect(billing.aplicarDevolucion.mock.calls.map((c: any[]) => c[0].tipo)).toEqual(['REEMBOLSO', 'CONTRACARGO']);
  });

  it('el de un cobro VIEJO no cancela el período en curso', async () => {
    const { billing, evento } = montar();
    await evento('PURCHASE_REFUNDED', 'HP-DE-JULIO');
    expect(billing.aplicarDevolucion).toHaveBeenCalledWith(expect.objectContaining({ esDelPeriodoActual: false }));
  });
});

describe('2 · el cliente cancela EN Hotmart', () => {
  it('queda cancelado por el cliente en la pasarela, respetando lo pagado', async () => {
    const { billing, evento } = montar();
    await evento('SUBSCRIPTION_CANCELLATION');
    expect(billing.registrarCancelacion).toHaveBeenCalledWith('t-protein', expect.objectContaining({
      origen: 'CLIENTE_PASARELA',
      desconectar: 'segun_lo_pagado',
    }));
    expect(billing.aplicarDevolucion).not.toHaveBeenCalled();
  });
});

describe('4 · el cobro que falla sigue siendo MORA, no cancelación', () => {
  it('PURCHASE_DELAYED no cancela nada', async () => {
    const { billing, evento } = montar();
    await evento('PURCHASE_DELAYED', 'HP9').catch(() => null);
    expect(billing.registrarCancelacion).not.toHaveBeenCalled();
    expect(billing.aplicarDevolucion).not.toHaveBeenCalled();
  });
});
