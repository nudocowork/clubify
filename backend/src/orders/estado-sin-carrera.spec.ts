import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Cambiar el estado de un pedido dos veces a la vez no dispara los efectos dos
 * veces.
 *
 * EL BUG: `setStatus` leía el pedido, decidía que la transición era válida y
 * escribía — tres pasos sueltos. Dos peticiones casi simultáneas (doble clic,
 * dos pantallas abiertas en la caja, un reintento de la red) leían las dos
 * «PENDIENTE» y las dos confirmaban: dos automatizaciones, dos SMS al cliente,
 * dos avisos a la empresa de domicilios y, al entregar, dos sellos. En
 * producción, 6 pedidos cambiaron DOS veces al mismo estado en menos de 1,3 s.
 *
 * El arreglo: la escritura solo pasa si el pedido SIGUE en el estado leído
 * (`updateMany` condicional) y, si no pasó, no se ejecuta ningún efecto.
 */

const DUENO: AuthUser = {
  id: 'u1',
  email: 'dueno@negocio.co',
  role: 'TENANT_OWNER' as any,
  tenantId: 't1',
};

function montar(estadoInicial = 'PENDING') {
  const fila = {
    id: 'o1',
    tenantId: 't1',
    customerId: 'c1',
    code: 'ABC123',
    status: estadoInicial,
    fulfillment: 'PICKUP',
    total: 25000,
    locationId: null,
  };
  const prisma = {
    fila,
    order: {
      // Cada lectura devuelve una FOTO, como la base: no la fila viva.
      findUnique: vi.fn(async () => ({ ...fila, customer: {}, events: [], location: null, delivery: null })),
      update: vi.fn(async ({ data }: any) => {
        Object.assign(fila, data);
        return { ...fila };
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== fila.id || (where.status && where.status !== fila.status)) {
          return { count: 0 };
        }
        Object.assign(fila, data);
        return { count: 1 };
      }),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ status: 'ACTIVE', deliveryAlertsEnabled: false })),
    },
    orderEvent: { create: vi.fn(async () => ({})) },
    event: { create: vi.fn(async () => ({})) },
    card: { findMany: vi.fn(async () => []) },
    stamp: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
  };
  const automations = { emit: vi.fn(async () => undefined) };
  const customerOrderSms = { notify: vi.fn(async () => undefined) };
  const delivery = {
    ensureForOrder: vi.fn(async () => undefined),
    notifyCompanyReadyForPickup: vi.fn(async () => undefined),
    markDelivered: vi.fn(async () => undefined),
    markCancelled: vi.fn(async () => undefined),
  };
  const svc = new OrdersService(
    prisma as any,
    null as any,
    null as any,
    automations as any,
    { broadcastOrderUpsert: vi.fn() } as any,
    { send: vi.fn(async () => undefined) } as any,
    { pushPassUpdate: vi.fn(async () => undefined) } as any,
    null as any,
    null as any,
    null as any,
    delivery as any,
    customerOrderSms as any,
    null as any,
    null as any,
  );
  return { svc, prisma, automations, customerOrderSms };
}

describe('cambio de estado sin carrera', () => {
  it('dos «Confirmar» a la vez: efectos UNA sola vez', async () => {
    const { svc, prisma, automations, customerOrderSms } = montar('PENDING');
    await Promise.all([
      svc.setStatus(DUENO, 'o1', 'CONFIRMED'),
      svc.setStatus(DUENO, 'o1', 'CONFIRMED'),
    ]);
    expect(prisma.fila.status).toBe('CONFIRMED');
    const confirmaciones = automations.emit.mock.calls.filter(
      (c: any[]) => c[0] === 'ORDER_CONFIRMED',
    );
    expect(confirmaciones).toHaveLength(1);
    expect(prisma.orderEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.event.create).toHaveBeenCalledTimes(1);
    expect(customerOrderSms.notify).toHaveBeenCalledTimes(1);
  });

  it('el que llega tarde al mismo estado recibe el pedido, sin error', async () => {
    const { svc } = montar('PENDING');
    const [a, b] = await Promise.all([
      svc.setStatus(DUENO, 'o1', 'CONFIRMED'),
      svc.setStatus(DUENO, 'o1', 'CONFIRMED'),
    ]);
    expect((a as any).status).toBe('CONFIRMED');
    expect((b as any).status).toBe('CONFIRMED');
  });

  it('si otro lo movió a OTRO estado mientras tanto, no pisa ni dispara nada', async () => {
    const { svc, prisma, automations } = montar('PENDING');
    // Entre la lectura y la escritura, alguien lo cancela desde otra pantalla.
    prisma.tenant.findUnique.mockImplementationOnce(async () => {
      prisma.fila.status = 'CANCELLED';
      return { status: 'ACTIVE', deliveryAlertsEnabled: false };
    });
    await expect(svc.setStatus(DUENO, 'o1', 'CONFIRMED')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.fila.status).toBe('CANCELLED');
    expect(automations.emit).not.toHaveBeenCalled();
    expect(prisma.orderEvent.create).not.toHaveBeenCalled();
  });
});
