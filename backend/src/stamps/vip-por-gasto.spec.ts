import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { GamificationService } from '../badges/gamification.service';
import type { AutomationsService } from '../automations/automations.service';
import type { PassesService } from '../passes/passes.service';
import type { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { StampsService } from './stamps.service';
import { bdVacia, crearDobles, crearPrismaFalso, pase, tarjeta, type BaseDeDatos } from './stamps-prisma-falso';

/**
 * VIP por niveles contra el SERVICIO REAL (auditoría 2026-11-26): por gasto el
 * nivel no subía nunca, y el Android recibía «Nuevo nivel» en cada compra.
 */

const DUENO: AuthUser = {
  id: 'u1',
  email: 'dueno@negocio.test',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

const NIVELES = [
  { name: 'Plata', threshold: 0 },
  { name: 'Oro', threshold: 100000, perks: ['Bebida gratis'] },
];

function montar(bd: BaseDeDatos) {
  const falso = crearPrismaFalso(bd);
  const d = crearDobles();
  const svc = new StampsService(
    falso.prisma as unknown as PrismaService,
    d.wallet as unknown as WalletService,
    d.jobs as unknown as QueueService,
    d.gamification as unknown as GamificationService,
    d.automations as unknown as AutomationsService,
    d.passes as unknown as PassesService,
    d.brand as unknown as WhitelabelBrandService,
  );
  return { svc, d };
}

function negocio(tierMetric: string | null = null): BaseDeDatos {
  const bd = bdVacia();
  // Tope de 1 por día a propósito: la compra VIP no debe chocar con él.
  bd.tenants.push({ id: 't1', maxStampsPerDay: 1 });
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Cliente' });
  bd.tarjetas.push(tarjeta({ id: 'vip', type: 'MEMBERSHIP', tiers: NIVELES, tierMetric }));
  bd.pases.push(pase({ id: 'p1', cardId: 'vip', currentTier: 'Plata', tierProgress: 0 }));
  return bd;
}

describe('VIP por gasto', () => {
  it('la compra suma lo gastado y sube de nivel con su aviso', async () => {
    const bd = negocio();
    const { svc, d } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'VISIT', purchaseAmount: 60000 });
    expect(Number(bd.pases[0].tierProgress)).toBe(60000);
    expect(bd.pases[0].currentTier).toBe('Plata');
    // Sin cambio de nivel no hay texto propio (y el genérico de Google está apagado).
    expect(d.empujes.at(-1)?.message).toBeUndefined();

    // Segunda compra del mismo día: el tope de sellos no aplica a la VIP.
    await svc.record(DUENO, { passId: 'p1', action: 'VISIT', purchaseAmount: 50000 });
    expect(Number(bd.pases[0].tierProgress)).toBe(110000);
    expect(bd.pases[0].currentTier).toBe('Oro');
    expect(d.empujes.at(-1)?.message).toEqual({
      header: '¡Subiste de nivel!',
      body: 'Ahora eres Oro. Bebida gratis',
    });
  });

  it('sin monto se rechaza con un mensaje claro', async () => {
    const bd = negocio();
    const { svc } = montar(bd);
    await expect(svc.record(DUENO, { passId: 'p1', action: 'VISIT' })).rejects.toThrow(
      new BadRequestException('Escribe el monto de la compra para sumar a su nivel.'),
    );
    expect(bd.sellos).toHaveLength(0);
  });

  it('la compra queda guardada con su monto (alimenta la facturación)', async () => {
    const bd = negocio();
    const { svc } = montar(bd);
    await svc.record(DUENO, { passId: 'p1', action: 'VISIT', purchaseAmount: 25000 });
    expect(Number(bd.sellos[0].purchaseAmount)).toBe(25000);
  });
});

describe('VIP por visitas', () => {
  it('cada visita suma 1, sin exigir monto', async () => {
    const bd = negocio('visits');
    const { svc } = montar(bd);
    await svc.record(DUENO, { passId: 'p1', action: 'VISIT' });
    expect(Number(bd.pases[0].tierProgress)).toBe(1);
  });
});
