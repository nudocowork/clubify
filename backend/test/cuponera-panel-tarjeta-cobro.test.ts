import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Tarjeta Wallet y cobro, ya en el panel (2026-09-01).
 *
 * Estas tres cosas vivían solo en /superadmin/living-card, sobre métodos que
 * llaman `ensureLivingCampaign()` por dentro: editaban SIEMPRE la primera
 * cuponera. Al unificar las dos pantallas del Master Admin en una, se portaron
 * al panel — y lo que hay que blindar es justamente que ahora sí respeten la
 * campaña que resolvió `resolveAdminCampaign`, no la primera.
 */
function make(campaign: any = { id: 'camp-mia', tenantId: 'tnt-mia', cardId: 'card-mia', slug: 'mia' }) {
  const prisma = {
    card: { findUnique: vi.fn().mockResolvedValue({ id: 'card-mia', name: 'Tarjeta' }) },
    benefitCampaign: { update: vi.fn().mockResolvedValue({}) },
    membershipPlan: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const cards = {
    update: vi.fn().mockResolvedValue({ id: 'card-mia' }),
    create: vi.fn().mockResolvedValue({ id: 'card-nueva' }),
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).cards = cards;
  (svc as any).sysUser = () => ({ id: 'sys', role: 'SUPER_ADMIN' });
  (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue(campaign);
  (svc as any).ensureLivingCampaign = vi.fn().mockResolvedValue({
    id: 'camp-PRIMERA', tenantId: 'tnt-primera', slug: 'living-card',
  });
  return { svc, prisma, cards };
}
const user = { id: 'u1', role: 'CUPONERA_ADMIN', campaignId: 'camp-mia' } as any;

describe('panel — tarjeta Wallet', () => {
  it('actualiza la tarjeta de SU campaña, no la de la primera cuponera', async () => {
    const { svc, cards } = make();
    await svc.panelDesignCard(user, { name: 'Nueva' } as any);
    expect(cards.update).toHaveBeenCalledWith(expect.anything(), 'card-mia', { name: 'Nueva' });
    // Si cayera en ensureLivingCampaign(), habría editado card de otra campaña.
    expect((svc as any).ensureLivingCampaign).not.toHaveBeenCalled();
  });

  it('si la campaña aún no tiene tarjeta, la crea en SU tenant y la enlaza', async () => {
    const { svc, prisma, cards } = make({ id: 'camp-mia', tenantId: 'tnt-mia', cardId: null });
    await svc.panelDesignCard(user, { name: 'Primera' } as any);
    expect(cards.create).toHaveBeenCalledWith(expect.anything(), { name: 'Primera' }, 'tnt-mia');
    expect(prisma.benefitCampaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-mia' },
      data: { cardId: 'card-nueva' },
    });
  });

  it('pasa por resolveAdminCampaign — es lo que impide mirar la cuponera de otro', async () => {
    const { svc } = make();
    await svc.panelCard(user, 'camp-ajena');
    expect((svc as any).resolveAdminCampaign).toHaveBeenCalledWith(user, 'camp-ajena');
  });
});

describe('panel — pasarelas', () => {
  it('consulta el estado de SU campaña, no el de la primera', async () => {
    const { svc } = make();
    const spy = vi.fn().mockResolvedValue({});
    (svc as any).gatewaysStatus = spy;
    await svc.panelGateways(user);
    expect(spy).toHaveBeenCalledWith('camp-mia');
  });
});

describe('DTO del panel — el whitelist no puede tragarse el mapeo', () => {
  it('PanelPlanPatchBody declara los campos de Hotmart y Stripe', async () => {
    // Sin estos campos declarados, el ValidationPipe los descarta ANTES del
    // servicio: el mapeo se guardaría "bien" y no guardaría nada.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/cuponera/cuponera-panel.controller.ts', import.meta.url),
      'utf8',
    );
    const dto = src.slice(
      src.indexOf('class PanelPlanPatchBody'),
      src.indexOf('}', src.indexOf('class PanelPlanPatchBody')),
    );
    for (const campo of [
      'hotmartProductId', 'hotmartOfferCode', 'stripePriceId',
      'hotmartCheckoutUrl', 'stripeCheckoutUrl',
    ]) {
      expect(dto).toContain(campo);
    }
  });
});
