import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from './orders.service';

/**
 * El SMS a las empresas de domicilio no sale para un pedido de OFICINA.
 *
 * Un pedido hecho desde el enlace de una oficina (`?oficina=`) es DELIVERY
 * porque sale del menú de domicilio, pero se entrega andando dentro del
 * coworking. En `delivery.service.ts` ya se cerró (no se crea seguimiento ni
 * se avisa «listo para recoger»), pero `maybeNotifyDeliveryAlert` se quedó
 * fuera: la empresa de domicilios seguía recibiendo «NUEVO PEDIDO DELIVERY —
 * Dirección: Sala de Juntas» por un pedido que nadie iba a recoger. Y cada SMS
 * lo paga el negocio.
 */

function montar(deliveryAddress: unknown) {
  const grow = { sendSmsWithCreds: vi.fn(async () => ({ ok: true })) };
  const prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        id: 't1',
        whiteLabelId: null,
        brandName: 'Nudo Cowork',
        currencySymbol: '$',
        whatsappDeliveryPhone: null,
        deliveryAlertsEnabled: true,
        deliveryAlertsPhones: ['+57 3170000000'],
        deliveryAlertsEvents: ['created', 'confirmed'],
        deliveryAlertsAccountId: null,
        growBusinessLocationId: 'loc-1',
        growBusinessApiKey: 'key-1',
        growBusinessSwitchNumber: null,
        whiteLabel: null,
      })),
    },
    order: {
      findUnique: vi.fn(async () => ({
        id: 'o1',
        code: 'YD6J7P',
        total: 20000,
        fulfillment: 'DELIVERY',
        deliveryAddress,
        customer: { fullName: 'Ana', phone: '+57 3001234567' },
        customerPaymentMethod: null,
        customerPaymentOther: null,
        paymentStatus: 'NOT_REQUIRED',
        customerNote: null,
        customerBusinessName: null,
        customerTaxInfo: null,
      })),
    },
    // Plantillas de mensaje por marca: sin personalizar, sale la de fábrica.
    setting: { findMany: vi.fn(async () => []) },
    event: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    growBusinessAccount: { findFirst: vi.fn(async () => null) },
  };
  const svc = new OrdersService(
    prisma as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any,
    grow as any,
    null as any, null as any, null as any, null as any, null as any,
  ) as any;
  return { svc, grow };
}

const OFICINA = {
  oficina: { id: 'menu-sala', nombre: 'Sala de Juntas' },
  direccion: 'Sala de Juntas',
};

describe('SMS a la empresa de domicilios', () => {
  it('NO sale para un pedido entregado en una oficina', async () => {
    const { svc, grow } = montar(OFICINA);
    await svc.maybeNotifyDeliveryAlert('t1', 'o1', 'created');
    await svc.maybeNotifyDeliveryAlert('t1', 'o1', 'confirmed');
    expect(grow.sendSmsWithCreds).not.toHaveBeenCalled();
  });

  it('sigue saliendo para un domicilio de verdad', async () => {
    const { svc, grow } = montar({ direccion: 'Calle 45 #12-30' });
    await svc.maybeNotifyDeliveryAlert('t1', 'o1', 'created');
    expect(grow.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });
});
