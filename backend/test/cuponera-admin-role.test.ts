import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Administrador propio de una cuponera (spec §3 y §4).
 *
 * El rol CUPONERA_ADMIN existe para ver UNA cuponera y nada más. Lo que se
 * prueba acá es el borde: que no pueda mirar otra pidiéndola por id, y que
 * PLATFORM_OWNER sí pueda entrar a cualquiera (§1).
 */
function make(campaign: unknown = { id: 'camp-mia', name: 'Living Card' }) {
  const prisma = {
    benefitCampaign: { findUnique: vi.fn().mockResolvedValue(campaign) },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'u1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).ensureLivingCampaign = vi.fn().mockResolvedValue({ id: 'camp-default' });
  return { svc, prisma };
}
const admin = (campaignId: string | null) =>
  ({ id: 'u1', role: 'CUPONERA_ADMIN', campaignId }) as any;
const owner = { id: 'u2', role: 'PLATFORM_OWNER' } as any;

describe('resolveAdminCampaign — aislamiento entre cuponeras', () => {
  it('el admin de cuponera NO puede mirar otra pidiéndola por id', async () => {
    const { svc } = make();
    await expect(
      svc.resolveAdminCampaign(admin('camp-mia'), 'camp-ajena'),
    ).rejects.toThrow(/no es tuya/i);
  });

  it('sin campaignId en la sesión, no pasa', async () => {
    const { svc } = make();
    await expect(svc.resolveAdminCampaign(admin(null))).rejects.toThrow(/sin cuponera/i);
  });

  it('el admin resuelve SIEMPRE su propia cuponera, ignore lo que pida', async () => {
    const { svc, prisma } = make();
    await svc.resolveAdminCampaign(admin('camp-mia'));
    expect(prisma.benefitCampaign.findUnique).toHaveBeenCalledWith({ where: { id: 'camp-mia' } });
  });

  it('pedir la PROPIA por id sí funciona', async () => {
    const { svc } = make();
    await expect(svc.resolveAdminCampaign(admin('camp-mia'), 'camp-mia')).resolves.toMatchObject({
      id: 'camp-mia',
    });
  });

  it('PLATFORM_OWNER puede entrar a cualquier cuponera (§1)', async () => {
    const { svc, prisma } = make({ id: 'camp-ajena' });
    await expect(svc.resolveAdminCampaign(owner, 'camp-ajena')).resolves.toMatchObject({
      id: 'camp-ajena',
    });
    expect(prisma.benefitCampaign.findUnique).toHaveBeenCalledWith({ where: { id: 'camp-ajena' } });
  });
});

describe('createCampaignAdmin', () => {
  it('404 si la cuponera no existe', async () => {
    const { svc } = make(null);
    await expect(
      svc.createCampaignAdmin('no-existe', { email: 'a@b.com', fullName: 'A' }),
    ).rejects.toThrow(/no encontrada/i);
  });

  it('crea con rol CUPONERA_ADMIN y colgado de ESA cuponera', async () => {
    const { svc, prisma } = make();
    await svc.createCampaignAdmin('camp-mia', { email: 'A@B.com ', fullName: 'Ana' });
    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.role).toBe('CUPONERA_ADMIN');
    expect(data.campaignId).toBe('camp-mia');
    expect(data.email).toBe('a@b.com'); // normalizado
  });

  it('NO le pone tenantId: una cuponera no es un negocio', async () => {
    const { svc, prisma } = make();
    await svc.createCampaignAdmin('camp-mia', { email: 'a@b.com', fullName: 'Ana' });
    expect(prisma.user.create.mock.calls[0][0].data.tenantId).toBeUndefined();
  });

  it('rechaza email repetido', async () => {
    const { svc, prisma } = make();
    prisma.user.findUnique = vi.fn().mockResolvedValue({ id: 'ya-existe' });
    await expect(
      svc.createCampaignAdmin('camp-mia', { email: 'a@b.com', fullName: 'Ana' }),
    ).rejects.toThrow(/ya existe/i);
  });

  it('valida email y nombre', async () => {
    const { svc } = make();
    await expect(
      svc.createCampaignAdmin('camp-mia', { email: 'sin-arroba', fullName: 'Ana' }),
    ).rejects.toThrow(/email inválido/i);
    await expect(
      svc.createCampaignAdmin('camp-mia', { email: 'a@b.com', fullName: '  ' }),
    ).rejects.toThrow(/nombre/i);
  });

  it('devuelve la clave temporal solo cuando la generó ella', async () => {
    const { svc } = make();
    const gen = await svc.createCampaignAdmin('camp-mia', { email: 'a@b.com', fullName: 'Ana' });
    expect(gen.tempPassword).toBeTruthy();
    const dada = await svc.createCampaignAdmin('camp-mia', {
      email: 'c@d.com',
      fullName: 'Ana',
      password: 'la-mia',
    });
    expect(dada.tempPassword).toBeUndefined();
  });

  it('nunca devuelve el passwordHash', async () => {
    const { svc, prisma } = make();
    await svc.createCampaignAdmin('camp-mia', { email: 'a@b.com', fullName: 'Ana' });
    expect(prisma.user.create.mock.calls[0][0].select.passwordHash).toBeUndefined();
  });
});
