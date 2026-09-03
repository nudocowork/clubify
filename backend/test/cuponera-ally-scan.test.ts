import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * AISLAMIENTO del escáner Tipo A (spec §16).
 *
 * Este método abre —de forma acotada— la guarda que separa a TODOS los negocios
 * entre sí. Lo que se prueba acá no es que funcione, es que NO funcione cuando
 * no corresponde: cada caso que devuelva algo distinto de null sin estar
 * autorizado es un agujero de aislamiento entre marcas.
 */
const CAMPAIGN = { id: 'camp-1', tenantId: 'tenant-sistema', status: 'ACTIVE' };
const PASS = { id: 'pass-1', tenantId: 'tenant-sistema', customerId: 'cust-1' };

function make(overrides: {
  campaign?: unknown;
  ally?: unknown;
}) {
  const prisma = {
    benefitCampaign: { findUnique: vi.fn().mockResolvedValue(overrides.campaign ?? null) },
    allyBusiness: { findFirst: vi.fn().mockResolvedValue(overrides.ally ?? null) },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).buildMemberScan = vi.fn().mockResolvedValue({ ok: true });
  return { svc, prisma };
}

const user = (tenantId: string | null) => ({ id: 'u1', tenantId, role: 'OWNER' }) as any;

describe('scanMemberAsTenantAlly — aislamiento', () => {
  it('null si la sesión no tiene tenant', async () => {
    const { svc, prisma } = make({ campaign: CAMPAIGN, ally: { id: 'a1' } });
    expect(await svc.scanMemberAsTenantAlly(user(null), PASS)).toBeNull();
    // Ni siquiera consulta: corta antes.
    expect(prisma.benefitCampaign.findUnique).not.toHaveBeenCalled();
  });

  it('null si el pase NO es de una cuponera (tarjeta normal de otro negocio)', async () => {
    const { svc } = make({ campaign: null });
    expect(await svc.scanMemberAsTenantAlly(user('tenant-nudo'), PASS)).toBeNull();
  });

  it('null si la campaña existe pero NO está activa', async () => {
    for (const status of ['DRAFT', 'PAUSED', 'ARCHIVED']) {
      const { svc } = make({ campaign: { ...CAMPAIGN, status }, ally: { id: 'a1' } });
      expect(await svc.scanMemberAsTenantAlly(user('tenant-nudo'), PASS)).toBeNull();
    }
  });

  it('null si el negocio NO es aliado de esa campaña', async () => {
    const { svc } = make({ campaign: CAMPAIGN, ally: null });
    expect(await svc.scanMemberAsTenantAlly(user('tenant-ajeno'), PASS)).toBeNull();
  });

  it('solo consulta aliados de ESA campaña, con ESE tenant y APPROVED', async () => {
    const { svc, prisma } = make({ campaign: CAMPAIGN, ally: { id: 'a1', categoryId: null } });
    await svc.scanMemberAsTenantAlly(user('tenant-nudo'), PASS);
    const where = prisma.allyBusiness.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      campaignId: 'camp-1',
      tenantId: 'tenant-nudo',
      status: 'APPROVED',
    });
  });

  it('la campaña se resuelve por el TENANT DEL PASE (multi-cuponera)', async () => {
    const { svc, prisma } = make({ campaign: CAMPAIGN, ally: { id: 'a1', categoryId: null } });
    await svc.scanMemberAsTenantAlly(user('tenant-nudo'), PASS);
    expect(prisma.benefitCampaign.findUnique).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-sistema' },
    });
  });

  it('deja pasar SOLO al aliado aprobado de una campaña activa', async () => {
    const { svc } = make({ campaign: CAMPAIGN, ally: { id: 'a1', categoryId: null } });
    expect(await svc.scanMemberAsTenantAlly(user('tenant-nudo'), PASS)).toEqual({ ok: true });
  });
});
