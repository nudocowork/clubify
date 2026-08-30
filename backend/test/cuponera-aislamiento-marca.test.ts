import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Aislamiento por MARCA al listar negocios de una cuponera.
 *
 * Bug real (código del 27-ago): el filtro se armaba como
 * `...(campaign.whiteLabelId ? { whiteLabelId } : {})`. Con marca nula el
 * spread quedaba vacío y **desaparecía el filtro entero**, así que la consulta
 * devolvía TODOS los negocios de la plataforma — nombres y slugs de clientes de
 * otras marcas — a un CUPONERA_ADMIN que solo debe ver los suyos.
 *
 * Y no hacía falta un error humano para llegar ahí:
 * `BenefitCampaign.whiteLabelId` es `onDelete: SetNull`, o sea que **borrar una
 * marca deja su cuponera sin marca** y el aislamiento se cae solo.
 */
function make() {
  const prisma = {
    allyBusiness: { findMany: vi.fn().mockResolvedValue([]) },
    tenant: { findMany: vi.fn().mockResolvedValue([{ id: 'x' }]) },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  return { svc, prisma };
}
const conMarca = { id: 'c1', slug: 'living-card', whiteLabelId: 'wl-clubify' };
const sinMarca = { id: 'c1', slug: 'huerfana', whiteLabelId: null };

describe('panelTenantOptions — aislamiento', () => {
  it('con marca, filtra por esa marca', async () => {
    const { svc, prisma } = make();
    (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue(conMarca);
    await svc.panelTenantOptions({} as any);
    expect(prisma.tenant.findMany.mock.calls[0][0].where.whiteLabelId).toBe('wl-clubify');
  });

  // El corazón del bug: sin marca NO puede significar "todas las marcas".
  it('SIN marca no lista nada, y ni siquiera consulta', async () => {
    const { svc, prisma } = make();
    (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue(sinMarca);
    await expect(svc.panelTenantOptions({} as any)).resolves.toEqual([]);
    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
  });

  it('sin marca deja el motivo en el log, o nadie sabe por qué está vacío', async () => {
    const { svc } = make();
    (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue(sinMarca);
    await svc.panelTenantOptions({} as any);
    const msg = (svc as any).logger.error.mock.calls[0][0] as string;
    expect(msg).toContain('huerfana');
    expect(msg).toMatch(/sin marca|whiteLabelId nulo/i);
  });

  it('nunca arma un where sin filtro de marca', async () => {
    const { svc, prisma } = make();
    (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue(conMarca);
    await svc.panelTenantOptions({} as any);
    for (const call of prisma.tenant.findMany.mock.calls) {
      expect(call[0].where).toHaveProperty('whiteLabelId');
    }
  });
});
