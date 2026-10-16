import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';

/**
 * «Generar comisión ahora», el pago manual y «Pendientes de aprobación» pasan
 * todos por `backfillCommissionForCurrentAssignment`. Elegía el registro MÁS
 * RECIENTE del negocio, y en un negocio vendido por un embajador ese es el
 * parent-use de su influencer: le pagaba al influencer su % completo y nada al
 * embajador (mismo bug que MOTILART en el webhook).
 */
function servicio(usos: any[]) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.prisma = {
    referralUse: { findMany: vi.fn(async () => usos) },
    commission: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
  };
  svc.backfillCommissionForAssignment = vi.fn(async () => null);
  return svc;
}

describe('pago manual · a quién se le genera la comisión', () => {
  it('MOTILART: el registro del embajador, aunque el del influencer sea posterior', async () => {
    const svc = servicio([
      { id: 'use-juan', referralCodeId: 'juan', status: 'PAYING', createdAt: new Date('2026-07-22'), referralCode: { role: 'INFLUENCER' } },
      { id: 'use-santiago', referralCodeId: 'santiago', status: 'PAYING', createdAt: new Date('2026-06-20'), referralCode: { role: 'AMBASSADOR' } },
    ]);

    const r = await svc.backfillCommissionForCurrentAssignment('motilart');

    expect(r.referralUseId).toBe('use-santiago');
    expect(svc.backfillCommissionForAssignment).toHaveBeenCalledWith('use-santiago', 'motilart', 'santiago', false);
  });

  it('con vendedor, el del vendedor (su reparto lo hace el motor)', async () => {
    const svc = servicio([
      { id: 'use-nico', referralCodeId: 'nicolas', status: 'PAYING', createdAt: new Date('2026-10-01'), referralCode: { role: 'INFLUENCER' } },
      { id: 'use-gabo', referralCodeId: 'gabriel', status: 'SIGNED_UP', createdAt: new Date('2026-09-01'), referralCode: { role: 'VENDOR' } },
    ]);
    const r = await svc.backfillCommissionForCurrentAssignment('enchurrados');
    expect(r.referralUseId).toBe('use-gabo');
  });

  it('sin afiliado de venta → error claro', async () => {
    const svc = servicio([]);
    await expect(svc.backfillCommissionForCurrentAssignment('x')).rejects.toThrow(/no tiene un afiliado/);
  });
});
