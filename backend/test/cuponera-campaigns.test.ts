import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Alta y edición de CUPONERAS desde el Master Admin de Fidelity (spec §1 y §2).
 *
 * Lo que se cuida acá: que la cuponera SIEMPRE quede colgada de una marca
 * blanca que existe, y que el slug no se cuele mal — es único en la tabla y
 * cuelga de URLs públicas.
 */
function make(opts: { dup?: unknown; wl?: unknown; tenant?: unknown } = {}) {
  const prisma = {
    benefitCampaign: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(opts.dup ?? null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
    },
    whiteLabel: { findUnique: vi.fn().mockResolvedValue(opts.wl === undefined ? { id: 'wl-1' } : opts.wl) },
    tenant: { findUnique: vi.fn(), create: vi.fn() },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).ensureCampaignTenant = vi.fn().mockResolvedValue(opts.tenant ?? { id: 'tenant-1' });
  return { svc, prisma };
}

describe('createCampaign — vínculo con la marca blanca (§2)', () => {
  it('rechaza si la marca blanca no existe: la cuponera quedaría huérfana', async () => {
    const { svc } = make({ wl: null });
    await expect(
      svc.createCampaign({ name: 'Living Card', whiteLabelId: 'no-existe' }),
    ).rejects.toThrow(/marca blanca no existe/i);
  });

  it('guarda el whiteLabelId verificado, no el que vino crudo', async () => {
    const { svc, prisma } = make({ wl: { id: 'wl-real' } });
    await svc.createCampaign({ name: 'Living Card', whiteLabelId: 'wl-real' });
    expect(prisma.benefitCampaign.create.mock.calls[0][0].data.whiteLabelId).toBe('wl-real');
  });
});

describe('createCampaign — slug', () => {
  it('lo deriva del nombre y normaliza acentos y espacios', async () => {
    const { svc, prisma } = make();
    await svc.createCampaign({ name: '  Cuponera Bucaramangá  ', whiteLabelId: 'wl-1' });
    expect(prisma.benefitCampaign.create.mock.calls[0][0].data.slug).toBe('cuponera-bucaramanga');
  });

  it('rechaza un nombre sin nada alfanumérico en vez de inventar un slug', async () => {
    const { svc } = make();
    await expect(svc.createCampaign({ name: '¡!!***', whiteLabelId: 'wl-1' })).rejects.toThrow(
      /slug inválido/i,
    );
  });

  it('rechaza un slug ya usado: es único en la tabla', async () => {
    const { svc } = make({ dup: { id: 'otra' } });
    await expect(svc.createCampaign({ name: 'Living Card', whiteLabelId: 'wl-1' })).rejects.toThrow(
      /ya existe una cuponera/i,
    );
  });

  it('exige nombre', async () => {
    const { svc } = make();
    await expect(svc.createCampaign({ name: '   ', whiteLabelId: 'wl-1' })).rejects.toThrow(/nombre/i);
  });
});

describe('createCampaign — estado inicial', () => {
  it('nace en DRAFT: una cuponera vacía no debe quedar publicada', async () => {
    const { svc, prisma } = make();
    await svc.createCampaign({ name: 'Living Card', whiteLabelId: 'wl-1' });
    expect(prisma.benefitCampaign.create.mock.calls[0][0].data.status).toBe('DRAFT');
  });

  it('cada cuponera recibe su PROPIO tenant de sistema', async () => {
    const { svc } = make();
    await svc.createCampaign({ name: 'Otra Cuponera', whiteLabelId: 'wl-1' });
    expect((svc as any).ensureCampaignTenant).toHaveBeenCalledWith(
      'sys-otra-cuponera',
      'Otra Cuponera',
      'wl-1',
    );
  });
});

describe('updateCampaignById', () => {
  it('404 si la cuponera no existe', async () => {
    const { svc } = make();
    (svc as any).prisma.benefitCampaign.findUnique = vi.fn().mockResolvedValue(null);
    await expect(svc.updateCampaignById('x', { name: 'y' })).rejects.toThrow(/no encontrada/i);
  });

  it('rechaza mover la cuponera a una marca blanca inexistente', async () => {
    const { svc, prisma } = make();
    prisma.benefitCampaign.findUnique = vi.fn().mockResolvedValue({ id: 'c1', config: {} });
    prisma.whiteLabel.findUnique = vi.fn().mockResolvedValue(null);
    await expect(svc.updateCampaignById('c1', { whiteLabelId: 'fantasma' })).rejects.toThrow(
      /marca blanca no existe/i,
    );
  });

  it('NO cambia el slug aunque venga en el body: cuelga de URLs vivas', async () => {
    const { svc, prisma } = make();
    prisma.benefitCampaign.findUnique = vi.fn().mockResolvedValue({ id: 'c1', config: {} });
    await svc.updateCampaignById('c1', { name: 'Nuevo' } as any);
    expect(prisma.benefitCampaign.update.mock.calls[0][0].data.slug).toBeUndefined();
  });

  it('conserva las claves de config que no vinieron en el body', async () => {
    const { svc, prisma } = make();
    prisma.benefitCampaign.findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'c1', config: { city: 'Bucaramanga', currency: 'COP' } });
    await svc.updateCampaignById('c1', { city: 'Bogotá' });
    const cfg = prisma.benefitCampaign.update.mock.calls[0][0].data.config;
    expect(cfg).toMatchObject({ city: 'Bogotá', currency: 'COP' });
  });
});
