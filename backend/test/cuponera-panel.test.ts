import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Panel de la cuponera (spec §4).
 *
 * Lo único que hace falta blindar acá es el SCOPE: cada consulta tiene que
 * filtrar por la campaña que resolvió `resolveAdminCampaign`, no por un id que
 * mandó el cliente. Un where sin campaignId sería una fuga entre cuponeras.
 */
function make() {
  const cap: Record<string, any> = {};
  const grab = (k: string) => vi.fn().mockImplementation((args: any) => {
    cap[k] = args;
    return Promise.resolve([]);
  });
  const prisma = {
    livingMembership: { count: vi.fn().mockResolvedValue(0), findMany: grab('members') },
    allyBusiness: { count: vi.fn().mockResolvedValue(0), findMany: grab('allies') },
    benefit: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    redemption: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: grab('redemptions'),
    },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).resolveAdminCampaign = vi
    .fn()
    .mockResolvedValue({ id: 'camp-mia', name: 'Living', slug: 'living', status: 'ACTIVE' });
  return { svc, prisma, cap };
}
const user = { id: 'u1', role: 'CUPONERA_ADMIN', campaignId: 'camp-mia' } as any;

describe('panel — todo scopeado por campaña', () => {
  it('allies filtra por campaignId', async () => {
    const { svc, cap } = make();
    await svc.panelAllies(user);
    expect(cap.allies.where).toEqual({ campaignId: 'camp-mia' });
  });

  it('members filtra por campaignId', async () => {
    const { svc, cap } = make();
    await svc.panelMembers(user);
    expect(cap.members.where).toEqual({ campaignId: 'camp-mia' });
  });

  it('redemptions filtra por campaignId e incluye la sede (§19)', async () => {
    const { svc, cap } = make();
    await svc.panelRedemptions(user);
    expect(cap.redemptions.where).toEqual({ campaignId: 'camp-mia' });
    expect(cap.redemptions.include.location).toBeTruthy();
  });

  it('overview cuenta SIEMPRE con campaignId, en todas sus consultas', async () => {
    const { svc, prisma } = make();
    await svc.panelOverview(user);
    const wheres = [
      ...prisma.livingMembership.count.mock.calls,
      ...prisma.allyBusiness.count.mock.calls,
      ...prisma.benefit.count.mock.calls,
      ...prisma.redemption.count.mock.calls,
    ].map((c) => c[0].where);
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w.campaignId).toBe('camp-mia');
  });

  it('los rankings también se agrupan dentro de la campaña', async () => {
    const { svc, prisma } = make();
    await svc.panelOverview(user);
    for (const call of prisma.redemption.groupBy.mock.calls) {
      expect(call[0].where).toEqual({ campaignId: 'camp-mia' });
    }
  });

  it('la campaña sale del resolver, no del id que mande el cliente', async () => {
    const { svc } = make();
    await svc.panelAllies(user, 'camp-ajena');
    // El resolver recibe lo pedido y decide; es él quien rechaza al admin ajeno.
    expect((svc as any).resolveAdminCampaign).toHaveBeenCalledWith(user, 'camp-ajena');
  });

  it('las redenciones del mes se cuentan desde el 1° y no desde hace 30 días', async () => {
    const { svc, prisma } = make();
    await svc.panelOverview(user);
    const conFecha = prisma.redemption.count.mock.calls
      .map((c) => c[0].where)
      .find((w) => w.createdAt?.gte);
    expect(conFecha).toBeTruthy();
    expect(conFecha.createdAt.gte.getUTCDate()).toBe(1); // 1° a las 00:00 Bogotá = 05:00 UTC
    expect(conFecha.createdAt.gte.getUTCHours()).toBe(5);
  });
});
