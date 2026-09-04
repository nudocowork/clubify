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

/**
 * La otra mitad de la MISMA fuga: la ESCRITURA.
 *
 * `panelTenantOptions` (arriba) solo ofrece los negocios de la marca, pero el
 * `tenantId` del aliado TIPO A (§16) llega en el body y hasta el 04-sep la
 * escritura no lo revalidaba: comprobaba que el negocio existiera y que no
 * fuera de sistema, nada más. Un POST a mano enlazaba cualquiera de los 107 de
 * la plataforma — lo publicaba en esta cartelera y hacía que sus canjes
 * contaran acá, porque un TIPO A canjea con SU propio escáner.
 *
 * Arreglar la lectura y dejar la escritura abierta no arregla nada: el filtro
 * de la pantalla es comodidad, no seguridad.
 */
function makeAlta(tenantEncontrado: any = null) {
  const prisma = {
    tenant: { findFirst: vi.fn().mockResolvedValue(tenantEncontrado), findUnique: vi.fn() },
    benefitCategory: { findFirst: vi.fn().mockResolvedValue({ id: 'cat1' }) },
    user: { findUnique: vi.fn().mockResolvedValue(null) },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  return { svc, prisma };
}

describe('createAlly — el negocio TIPO A tiene que ser de la marca', () => {
  const base = { name: 'Café', email: 'a@b.com', ownerFullName: 'Ana', tenantId: 'tnt-de-otra-marca' };

  it('rechaza un negocio que no es de la marca de la cuponera', async () => {
    // findFirst con el filtro de marca no lo encuentra → se rechaza.
    const { svc } = makeAlta(null);
    (svc as any).campaignOrLiving = vi.fn().mockResolvedValue(conMarca);
    await expect(svc.createAlly({ ...base } as any)).rejects.toThrow(/no es de esta marca/i);
  });

  it('la consulta del negocio SIEMPRE lleva el filtro de marca', async () => {
    const { svc, prisma } = makeAlta(null);
    (svc as any).campaignOrLiving = vi.fn().mockResolvedValue(conMarca);
    await svc.createAlly({ ...base } as any).catch(() => null);
    expect(prisma.tenant.findFirst.mock.calls[0][0].where.whiteLabelId).toBe('wl-clubify');
    // findUnique era el camino viejo: buscaba por id a secas, sin marca.
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('una cuponera SIN marca no puede enlazar ningún negocio existente', async () => {
    const { svc, prisma } = makeAlta(null);
    (svc as any).campaignOrLiving = vi.fn().mockResolvedValue(sinMarca);
    await expect(svc.createAlly({ ...base } as any)).rejects.toThrow(/marca asignada/i);
    expect(prisma.tenant.findFirst).not.toHaveBeenCalled();
  });

  it('sigue rechazando el tenant de sistema, que no puede ser aliado', async () => {
    const { svc } = makeAlta({ id: 'tnt-sys', isCampaignHost: true });
    (svc as any).campaignOrLiving = vi.fn().mockResolvedValue(conMarca);
    await expect(svc.createAlly({ ...base } as any)).rejects.toThrow(/negocio de sistema/i);
  });
});
