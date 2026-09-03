import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Avisos del aliado (spec §22).
 *
 * Lo que hay que blindar: que el aliado NO pueda escribirle a toda la comunidad
 * ni saltarse el límite. Un push sin tope es una vía directa a que la gente
 * desinstale la tarjeta.
 */
function make(opts: { limite?: number; usados?: number; status?: string } = {}) {
  const prisma = {
    allyPush: {
      count: vi.fn().mockResolvedValue(opts.usados ?? 0),
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  (svc as any).getAllyForPortal = vi.fn().mockResolvedValue({ id: 'ally-mio', status: opts.status ?? 'APPROVED' });
  (svc as any).ensureLivingCampaign = vi.fn().mockResolvedValue({
    id: 'camp-1',
    config: opts.limite === undefined ? {} : { allyPushPerWeek: opts.limite },
  });
  (svc as any).sendSegmentPush = vi.fn().mockResolvedValue({ ok: true, targeted: 5, sent: 5 });
  return { svc, prisma };
}
const user = { id: 'u1', allyBusinessId: 'ally-mio', role: 'ALLY_BUSINESS' } as any;
const msg = { title: 'Hoy 20% OFF', body: 'Vení con tu Living Card' };

describe('cuota', () => {
  it('sin configurar, el default es 1 por semana', async () => {
    const { svc } = make();
    expect(await svc.allyPushQuota(user)).toMatchObject({ limite: 1, usados: 0, restantes: 1 });
  });

  it('descuenta los ya usados', async () => {
    const { svc } = make({ limite: 3, usados: 2 });
    expect(await svc.allyPushQuota(user)).toMatchObject({ restantes: 1 });
  });

  it('nunca da restantes negativos', async () => {
    const { svc } = make({ limite: 1, usados: 5 });
    expect((await svc.allyPushQuota(user)).restantes).toBe(0);
  });

  it('la ventana arranca el LUNES, igual que los topes de beneficio', async () => {
    const { svc, prisma } = make();
    await svc.allyPushQuota(user);
    const desde = prisma.allyPush.count.mock.calls[0][0].where.createdAt.gte as Date;
    // 0=domingo … 1=lunes. En hora Bogotá (UTC-5) el inicio es 05:00 UTC.
    expect(new Date(desde.getTime() + 5 * 3600 * 1000).getUTCDay()).toBe(1);
  });
});

describe('envío', () => {
  it('el segmento sale de SU aliado, no del body', async () => {
    const { svc } = make();
    await svc.sendAllyPush(user, { ...msg, allyId: 'ally-ajeno' } as any);
    expect((svc as any).sendSegmentPush).toHaveBeenCalledWith(
      expect.objectContaining({ allyId: 'ally-mio' }),
    );
  });

  it('un aliado NO aprobado no puede enviar', async () => {
    for (const status of ['PENDING', 'REJECTED', 'SUSPENDED']) {
      const { svc } = make({ status });
      await expect(svc.sendAllyPush(user, msg)).rejects.toThrow(/no está aprobado/i);
    }
  });

  it('sin cupo, rechaza y NO envía', async () => {
    const { svc } = make({ limite: 1, usados: 1 });
    await expect(svc.sendAllyPush(user, msg)).rejects.toThrow(/ya usaste/i);
    expect((svc as any).sendSegmentPush).not.toHaveBeenCalled();
  });

  it('límite 0 apaga la función por completo', async () => {
    const { svc } = make({ limite: 0 });
    await expect(svc.sendAllyPush(user, msg)).rejects.toThrow(/desactivados/i);
    expect((svc as any).sendSegmentPush).not.toHaveBeenCalled();
  });

  it('exige título y mensaje', async () => {
    const { svc } = make();
    await expect(svc.sendAllyPush(user, { title: '  ', body: 'x' })).rejects.toThrow(/falta/i);
    await expect(svc.sendAllyPush(user, { title: 'x', body: '  ' })).rejects.toThrow(/falta/i);
  });

  it('registra el envío DESPUÉS de mandarlo, con lo que realmente salió', async () => {
    const { svc, prisma } = make();
    await svc.sendAllyPush(user, msg);
    const d = prisma.allyPush.create.mock.calls[0][0].data;
    expect(d).toMatchObject({ allyBusinessId: 'ally-mio', targeted: 5, sent: 5, userId: 'u1' });
  });

  it('si el push FALLA no se gasta el cupo', async () => {
    const { svc, prisma } = make();
    (svc as any).sendSegmentPush = vi.fn().mockRejectedValue(new Error('wallet caído'));
    await expect(svc.sendAllyPush(user, msg)).rejects.toThrow();
    expect(prisma.allyPush.create).not.toHaveBeenCalled();
  });
});
