import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { StorefrontService } from './storefront.service';

/**
 * El interruptor «Pedidos agendados» del menú se guarda en
 * `theme.pedidosAgendados` sin pisar lo demás de `theme` (recoger, mesa,
 * métodos de pago…), y un rango imposible no llega a la base: el cliente vería
 * el selector vacío sin saber por qué.
 */

const DUENO = { id: 'u1', role: 'TENANT_OWNER', tenantId: 't1' } as any;

function montar(theme: Record<string, unknown>) {
  const prisma: any = {
    storefront: {
      findUnique: vi.fn(async () => ({ theme })),
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async (a: any) => a.update),
    },
  };
  return { svc: new StorefrontService(prisma), prisma };
}

describe('ajustes de pedidos agendados', () => {
  it('se guardan junto a lo que ya había en theme', async () => {
    const { svc, prisma } = montar({ fulfillment: { pickup: true }, paymentMethods: ['EFECTIVO'] });
    await svc.update(DUENO, {
      pedidosAgendados: { activo: true, anticipacionHoras: 24, diasMaximos: 15 },
    });
    const theme = prisma.storefront.upsert.mock.calls[0][0].update.theme;
    expect(theme.pedidosAgendados).toEqual({ activo: true, anticipacionHoras: 24, diasMaximos: 15 });
    expect(theme.fulfillment).toEqual({ pickup: true });
    expect(theme.paymentMethods).toEqual(['EFECTIVO']);
    // Acotado al negocio de quien guarda.
    expect(prisma.storefront.upsert.mock.calls[0][0].where).toEqual({ tenantId: 't1' });
  });

  it('un rango imposible se rechaza con un mensaje que dice qué corregir', async () => {
    const { svc, prisma } = montar({});
    await expect(
      svc.update(DUENO, { pedidosAgendados: { activo: true, anticipacionHoras: 72, diasMaximos: 3 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update(DUENO, { pedidosAgendados: { activo: true, anticipacionHoras: 24 * 31, diasMaximos: 90 } }),
    ).rejects.toThrow('La anticipación mínima va de 0 a 30 días.');
    expect(prisma.storefront.upsert).not.toHaveBeenCalled();
  });

  it('sin tocar el interruptor, theme no se reescribe por esto', async () => {
    const { svc, prisma } = montar({ pedidosAgendados: { activo: true } });
    await svc.update(DUENO, { description: 'hola' });
    expect(prisma.storefront.upsert.mock.calls[0][0].update.theme).toBeUndefined();
  });
});
