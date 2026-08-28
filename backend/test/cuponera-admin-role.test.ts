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

/**
 * Escrituras del panel (§4 y §28: "conseguir aliados, administrar miembros").
 *
 * El invariante que se protege acá no es el aislamiento —ya lo cubre
 * `resolveAdminCampaign` arriba— sino que cada escritura baje el id RESUELTO y
 * nunca el que vino del cliente. Un método nuevo que pase `campaignId` directo
 * al escritor compilaría igual y dejaría escribir en cualquier cuponera.
 */
describe('escrituras del panel — usan la campaña RESUELTA, no la pedida', () => {
  function panel() {
    const svc = Object.create(CuponeraService.prototype) as CuponeraService;
    // El owner puede pedir cualquiera; lo que importa es qué id se propaga.
    (svc as any).resolveAdminCampaign = vi.fn().mockResolvedValue({ id: 'camp-resuelta' });
    (svc as any).createAlly = vi.fn().mockResolvedValue({});
    (svc as any).setAllyStatus = vi.fn().mockResolvedValue({});
    (svc as any).enrollMember = vi.fn().mockResolvedValue({});
    (svc as any).listCategories = vi.fn().mockResolvedValue([]);
    (svc as any).createCategory = vi.fn().mockResolvedValue({});
    (svc as any).setBenefitApproval = vi.fn().mockResolvedValue({});
    (svc as any).sendBroadcast = vi.fn().mockResolvedValue({});
    (svc as any).sendSegmentPush = vi.fn().mockResolvedValue({});
    (svc as any).createGeopush = vi.fn().mockResolvedValue({});
    (svc as any).createStampProgram = vi.fn().mockResolvedValue({});
    (svc as any).updateStampProgram = vi.fn().mockResolvedValue({});
    return svc;
  }
  const user = owner;

  it('createAlly recibe la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelCreateAlly(user, { name: 'X', campaignId: 'INYECTADA' }, 'camp-pedida');
    expect((svc as any).createAlly).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta' }),
    );
  });

  it('un campaignId metido en el body NO gana', async () => {
    const svc = panel();
    await svc.panelCreateAlly(user, { name: 'X', campaignId: 'camp-ajena' }, undefined);
    const arg = (svc as any).createAlly.mock.calls[0][0];
    expect(arg.campaignId).toBe('camp-resuelta');
  });

  it('setAllyStatus recibe la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelSetAllyStatus(user, 'ally-1', 'APPROVED' as any, 'camp-pedida');
    expect((svc as any).setAllyStatus).toHaveBeenCalledWith('ally-1', 'APPROVED', 'camp-resuelta');
  });

  it('enrollMember recibe la campaña resuelta y source MANUAL', async () => {
    const svc = panel();
    await svc.panelEnrollMember(user, { fullName: 'Ana' }, 'camp-pedida');
    expect((svc as any).enrollMember).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta', source: 'MANUAL' }),
    );
  });

  it('setBenefitApproval recibe la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelSetBenefitApproval(user, 'ben-1', 'APPROVED', 'camp-pedida');
    expect((svc as any).setBenefitApproval).toHaveBeenCalledWith('ben-1', 'APPROVED', user, 'camp-resuelta');
  });

  it('createCategory recibe la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelCreateCategory(user, { name: 'Cafés' }, 'camp-pedida');
    expect((svc as any).createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta' }),
    );
  });

  it('un aviso a TODOS va al broadcast de la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelSendPush(user, { title: 'T', body: 'B' }, 'camp-pedida');
    expect((svc as any).sendBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta' }),
    );
    expect((svc as any).sendSegmentPush).not.toHaveBeenCalled();
  });

  it('un aviso con segmento NO usa el broadcast', async () => {
    const svc = panel();
    await svc.panelSendPush(user, { title: 'T', body: 'B', planId: 'p1' }, 'camp-pedida');
    expect((svc as any).sendSegmentPush).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta', planId: 'p1' }),
    );
    expect((svc as any).sendBroadcast).not.toHaveBeenCalled();
  });

  it('un aviso sin título no llega a enviarse', async () => {
    const svc = panel();
    await expect(svc.panelSendPush(user, { title: '  ', body: 'B' })).rejects.toThrow(/título|mensaje/i);
    expect((svc as any).sendBroadcast).not.toHaveBeenCalled();
  });

  it('geopush y sellos reciben la campaña resuelta', async () => {
    const svc = panel();
    await svc.panelCreateGeopush(user, { name: 'Z', campaignId: 'INYECTADA' }, 'camp-pedida');
    expect((svc as any).createGeopush).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-resuelta' }),
    );
    await svc.panelCreateStampProgram(user, { name: 'S' }, 'camp-pedida');
    expect((svc as any).createStampProgram).toHaveBeenCalledWith({ name: 'S' }, 'camp-resuelta');
  });

  it('toda escritura pasa PRIMERO por resolveAdminCampaign', async () => {
    for (const correr of [
      (s: any) => s.panelCreateAlly(user, { name: 'X' }),
      (s: any) => s.panelSetAllyStatus(user, 'a', 'APPROVED'),
      (s: any) => s.panelEnrollMember(user, { fullName: 'A' }),
      (s: any) => s.panelCreateCategory(user, { name: 'C' }),
      (s: any) => s.panelSetBenefitApproval(user, 'b', 'APPROVED'),
      (s: any) => s.panelSendPush(user, { title: 'T', body: 'B' }),
      (s: any) => s.panelCreateGeopush(user, { name: 'Z' }),
      (s: any) => s.panelCreateStampProgram(user, { name: 'S' }),
    ]) {
      const svc = panel();
      await correr(svc);
      expect((svc as any).resolveAdminCampaign).toHaveBeenCalled();
    }
  });
});
