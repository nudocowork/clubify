import { describe, it, expect, vi } from 'vitest';
import { CuponeraService } from '../src/cuponera/cuponera.service';

/**
 * Candado de membresía (spec §24: "membresía inactiva → beneficios bloqueados").
 *
 * Lo que hay que blindar: antes CADA canje comparaba `status !== 'ACTIVE'` por su
 * cuenta y NADIE miraba `expiresAt`. Si el cobro recurrente simplemente deja de
 * llegar no hay webhook que avise, así que la fila se queda ACTIVE para siempre
 * y la tarjeta sigue canjeando gratis. Estos tests fijan que mande la fecha.
 */
const DIA = 24 * 60 * 60 * 1000;
const enDias = (n: number) => new Date(Date.now() + n * DIA);

function make(membership: any) {
  const prisma = {
    livingMembership: {
      findFirst: vi.fn().mockResolvedValue(membership),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const svc = Object.create(CuponeraService.prototype) as CuponeraService;
  (svc as any).prisma = prisma;
  return { svc, prisma };
}

const gate = (svc: CuponeraService) =>
  (svc as any).assertMembershipUsable('camp-1', 'cust-1') as Promise<any>;

describe('assertMembershipUsable', () => {
  it('deja pasar una membresía activa sin vencimiento', async () => {
    const { svc } = make({ id: 'm1', status: 'ACTIVE', expiresAt: null });
    await expect(gate(svc)).resolves.toMatchObject({ id: 'm1' });
  });

  it('deja pasar una activa cuyo vencimiento todavía no llegó', async () => {
    const { svc } = make({ id: 'm1', status: 'ACTIVE', expiresAt: enDias(10) });
    await expect(gate(svc)).resolves.toMatchObject({ id: 'm1' });
  });

  it('bloquea si no hay membresía en esta cuponera', async () => {
    const { svc } = make(null);
    await expect(gate(svc)).rejects.toThrow(/no tiene membresía/i);
  });

  it('bloquea una cancelada aunque la fecha siga vigente', async () => {
    const { svc } = make({ id: 'm1', status: 'CANCELLED', expiresAt: enDias(20) });
    await expect(gate(svc)).rejects.toThrow(/no está activa/i);
  });

  // El caso que motivó todo: nadie cambió el status, solo pasó el tiempo.
  it('bloquea una ACTIVE cuya fecha ya pasó (con el margen consumido)', async () => {
    const { svc } = make({ id: 'm1', status: 'ACTIVE', expiresAt: enDias(-10) });
    await expect(gate(svc)).rejects.toThrow(/venció/i);
  });

  it('al detectar el vencimiento corrige la fila a EXPIRED', async () => {
    const { svc, prisma } = make({ id: 'm1', status: 'ACTIVE', expiresAt: enDias(-10) });
    await gate(svc).catch(() => null);
    expect(prisma.livingMembership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'EXPIRED' },
    });
  });

  // Margen: la pasarela reintenta la tarjeta rechazada durante días. Cortar el
  // mismo día del vencimiento deja plantado en la caja a alguien que sí renueva.
  it('respeta el margen: vencida ayer todavía canjea', async () => {
    const { svc } = make({ id: 'm1', status: 'ACTIVE', expiresAt: enDias(-1) });
    await expect(gate(svc)).resolves.toMatchObject({ id: 'm1' });
  });

  it('pasado el margen ya no canjea', async () => {
    const { svc } = make({ id: 'm1', status: 'ACTIVE', expiresAt: enDias(-4) });
    await expect(gate(svc)).rejects.toThrow(/venció/i);
  });

  it('una vencida NO se corrige dos veces: ya está EXPIRED', async () => {
    const { svc, prisma } = make({ id: 'm1', status: 'EXPIRED', expiresAt: enDias(-40) });
    await expect(gate(svc)).rejects.toThrow(/no está activa/i);
    expect(prisma.livingMembership.update).not.toHaveBeenCalled();
  });
});
