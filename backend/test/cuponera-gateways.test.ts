import { describe, it, expect, vi } from 'vitest';
import { MembershipBillingService } from '../src/cuponera/membership-billing.service';

/**
 * Cobros de membresías por Hotmart y Stripe (spec §24-25).
 *
 * Lo que hay que blindar acá es plata:
 *  · No adivinar el plan cuando la oferta no matchea — dar de alta en el plan
 *    equivocado deja al miembro con la vigencia y los beneficios de otro.
 *  · No dar de alta dos veces por el mismo cobro (las pasarelas reintentan).
 *  · Que un cobro cobrado que no llegó a dar de alta quede VISIBLE, no perdido.
 */
const PLAN = {
  id: 'plan-mensual',
  campaignId: 'camp-1',
  name: 'Living Card Mensual',
  priceCents: 50000,
  currency: 'COP',
  hotmartOfferCode: 'ofr-mensual',
};
const PLAN_ANUAL = { ...PLAN, id: 'plan-anual', name: 'Anual', hotmartOfferCode: 'ofr-anual' };
const CAMPAIGN = { id: 'camp-1', slug: 'living-card', status: 'ACTIVE' };

function make(opts: {
  planes?: any[];
  campaign?: any;
  ordenPrevia?: any;
  enroll?: any;
} = {}) {
  const prisma = {
    membershipPlan: {
      findMany: vi.fn().mockResolvedValue(opts.planes ?? []),
      findFirst: vi.fn().mockResolvedValue((opts.planes ?? [])[0] ?? null),
    },
    benefitCampaign: {
      findUnique: vi.fn().mockResolvedValue(opts.campaign ?? CAMPAIGN),
    },
    membershipOrder: {
      findFirst: vi.fn().mockResolvedValue(opts.ordenPrevia ?? null),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'ord-1', ...a.data })),
      update: vi.fn().mockResolvedValue({}),
    },
    livingMembership: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const cuponera = {
    enrollMember:
      opts.enroll ??
      vi.fn().mockResolvedValue({ customerId: 'cust-1', passId: 'pass-1', membershipId: 'm1' }),
  };
  const svc = new MembershipBillingService(prisma as any, cuponera as any);
  return { svc, prisma, cuponera };
}

describe('matchHotmartPlan', () => {
  it('no es cuponera si el producto no está mapeado', async () => {
    const { svc } = make({ planes: [] });
    expect(await svc.matchHotmartPlan('999', 'ofr-x')).toBeNull();
  });

  it('sin productId no se mete', async () => {
    const { svc } = make({ planes: [PLAN] });
    expect(await svc.matchHotmartPlan(null, 'ofr-mensual')).toBeNull();
  });

  it('resuelve por offer code cuando hay varias ofertas del mismo producto', async () => {
    const { svc } = make({ planes: [PLAN, PLAN_ANUAL] });
    const r = await svc.matchHotmartPlan('123', 'ofr-anual');
    expect(r).not.toBe('ambiguous');
    expect((r as any).plan.id).toBe('plan-anual');
  });

  it('con UN solo plan del producto, no hace falta offer code', async () => {
    const { svc } = make({ planes: [PLAN] });
    const r = await svc.matchHotmartPlan('123', undefined);
    expect((r as any).plan.id).toBe('plan-mensual');
  });

  // El caso caro: NO adivinar.
  it('con varias ofertas y ninguna que matchee, se declara ambiguo', async () => {
    const { svc } = make({ planes: [PLAN, PLAN_ANUAL] });
    expect(await svc.matchHotmartPlan('123', 'ofr-desconocida')).toBe('ambiguous');
  });

  it('una cuponera en DRAFT no invalida el pago: la plata ya se cobró', async () => {
    const { svc } = make({ planes: [PLAN], campaign: { ...CAMPAIGN, status: 'DRAFT' } });
    const r = await svc.matchHotmartPlan('123', 'ofr-mensual');
    expect((r as any).campaign.status).toBe('DRAFT');
  });
});

describe('activate', () => {
  const base = {
    provider: 'HOTMART' as const,
    transactionRef: 'HP123',
    subscriptionRef: 'sub-9',
    email: 'Ana@Mail.com',
    fullName: 'Ana',
    phone: '+573001112233',
  };

  it('da de alta y deja la orden PAID', async () => {
    const { svc, prisma, cuponera } = make({ planes: [PLAN] });
    const r = await svc.activate({ match: { plan: PLAN, campaign: CAMPAIGN } as any, ...base });
    expect(r).toBe('cuponera_membership_activated');
    expect(cuponera.enrollMember).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'camp-1',
        planId: 'plan-mensual',
        source: 'HOTMART',
        providerRef: 'sub-9',
        email: 'ana@mail.com',
      }),
    );
    expect(prisma.membershipOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }),
    );
  });

  // Hotmart reintenta el mismo webhook varias veces.
  it('el mismo cobro dos veces no da de alta dos veces', async () => {
    const { svc, cuponera } = make({ planes: [PLAN], ordenPrevia: { id: 'ord-vieja' } });
    const r = await svc.activate({ match: { plan: PLAN, campaign: CAMPAIGN } as any, ...base });
    expect(r).toBe('cuponera_membership_duplicate');
    expect(cuponera.enrollMember).not.toHaveBeenCalled();
  });

  it('si el alta falla, la orden queda FAILED y no se pierde el cobro', async () => {
    const enroll = vi.fn().mockRejectedValue(new Error('Teléfono inválido'));
    const { svc, prisma } = make({ planes: [PLAN], enroll });
    const r = await svc.activate({ match: { plan: PLAN, campaign: CAMPAIGN } as any, ...base });
    expect(r).toBe('cuponera_membership_enroll_failed');
    expect(prisma.membershipOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('usa el vencimiento que dicta la pasarela', async () => {
    const { svc, cuponera } = make({ planes: [PLAN] });
    const hasta = new Date('2027-01-15T00:00:00Z');
    await svc.activate({ match: { plan: PLAN, campaign: CAMPAIGN } as any, ...base, expiresAt: hasta });
    expect(cuponera.enrollMember).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: hasta }),
    );
  });
});

describe('deactivate', () => {
  it('sin membresía con esa referencia, no hace nada', async () => {
    const { svc } = make();
    expect(await svc.deactivate({ provider: 'STRIPE', ref: 'sub-x', reason: 'test' }))
      .toBe('cuponera_membership_not_found');
  });

  it('cancela y corta el acceso', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst.mockResolvedValue({
      id: 'm1', customerId: 'c1', status: 'ACTIVE', campaignId: 'camp-1',
    });
    const r = await svc.deactivate({ provider: 'STRIPE', ref: 'sub-9', reason: 'cancel' });
    expect(r).toBe('cuponera_membership_cancelled');
    expect(prisma.livingMembership.update).toHaveBeenCalledWith({
      where: { id: 'm1' }, data: { status: 'CANCELLED' },
    });
  });

  it('cancelar dos veces no rompe', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst.mockResolvedValue({ id: 'm1', status: 'CANCELLED' });
    expect(await svc.deactivate({ provider: 'STRIPE', ref: 'sub-9', reason: 'cancel' }))
      .toBe('cuponera_membership_already_cancelled');
    expect(prisma.livingMembership.update).not.toHaveBeenCalled();
  });

  // Histórico: las membresías anteriores a §24 solo tienen mpPreapprovalId.
  it('encuentra membresías viejas de MercadoPago por su columna antigua', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'm-vieja', status: 'ACTIVE' });
    expect(await svc.deactivate({ provider: 'MERCADOPAGO', ref: 'pre-1', reason: 'cancel' }))
      .toBe('cuponera_membership_cancelled');
  });
});

describe('paymentFailed', () => {
  // Cortar al primer rechazo deja afuera a gente que sí termina pagando.
  it('NO da de baja: solo registra la orden fallida', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst.mockResolvedValue({
      id: 'm1', customerId: 'c1', campaignId: 'camp-1', planId: 'plan-mensual',
      status: 'ACTIVE', expiresAt: new Date(),
    });
    const r = await svc.paymentFailed({ provider: 'STRIPE', ref: 'sub-9', reason: 'invoice.payment_failed' });
    expect(r).toBe('cuponera_membership_payment_failed');
    expect(prisma.livingMembership.update).not.toHaveBeenCalled();
    expect(prisma.membershipOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
});

describe('renew', () => {
  it('corre el vencimiento y revive una vencida', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst.mockResolvedValue({
      id: 'm1', customerId: 'c1', campaignId: 'camp-1', planId: 'plan-mensual',
      status: 'EXPIRED', expiresAt: new Date('2026-01-01'),
    });
    const hasta = new Date('2027-03-01T00:00:00Z');
    const r = await svc.renew({ provider: 'HOTMART', ref: 'sub-9', until: hasta });
    expect(r).toBe('cuponera_membership_renewed');
    expect(prisma.livingMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE', expiresAt: hasta }),
      }),
    );
  });

  it('sin fecha de la pasarela, suma un ciclo', async () => {
    const { svc, prisma } = make();
    prisma.livingMembership.findFirst.mockResolvedValue({
      id: 'm1', customerId: 'c1', campaignId: 'camp-1', status: 'ACTIVE', expiresAt: null,
    });
    await svc.renew({ provider: 'HOTMART', ref: 'sub-9' });
    const arg = prisma.livingMembership.update.mock.calls[0][0];
    expect(arg.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
