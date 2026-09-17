import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from './orders.service';
import { ChannelsService } from '../channels/channels.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * `POST /orders/:id/accept-delivery-payment` no devuelve credenciales.
 *
 * EL BUG: la respuesta llevaba el pedido con `include: { tenant: true }`, es
 * decir, la fila ENTERA del negocio — con `growBusinessApiKey` en claro, entre
 * otros secretos — a cualquier empleado que pulsara «Aceptar pago» (incluidos
 * los de «solo pedidos»). La pantalla solo usa `courierLink` y
 * `courierConfigured`.
 */

const SECRETO = 'pit-secreto-de-grow-business';

const FILA_NEGOCIO = {
  id: 't1',
  status: 'ACTIVE',
  brandName: 'La Gloriosa',
  currency: 'COP',
  currencySymbol: '$',
  whatsappDeliveryPhone: '+57 3170000000',
  growBusinessApiKey: SECRETO,
  growBusinessLocationId: 'loc-1',
  hotmartSubscriberCode: 'hot-123',
};

/** Como Prisma: `true` trae todo; `{ select }` solo lo pedido. */
function relacion(pedido: any, fila: Record<string, any>) {
  if (pedido === true) return { ...fila };
  if (pedido?.select) {
    return Object.fromEntries(
      Object.keys(pedido.select).filter((k) => pedido.select[k]).map((k) => [k, fila[k]]),
    );
  }
  return undefined;
}

function montar(paymentStatus = 'PENDING') {
  const pedido = {
    id: 'o1',
    tenantId: 't1',
    customerId: 'c1',
    code: 'DOM123',
    status: 'CONFIRMED',
    fulfillment: 'DELIVERY',
    paymentStatus,
    paidAt: null,
    total: 30000,
    items: [{ qty: 1, name: 'Hamburguesa' }],
    deliveryAddress: { direccion: 'Calle 45 #12-30' },
    customerPaymentMethod: null,
    customerPaymentOther: null,
    customerNote: null,
    locationId: null,
  };
  const cliente = { id: 'c1', fullName: 'Ana', phone: '+57 3001234567' };
  const prisma = {
    order: {
      findUnique: vi.fn(async ({ include }: any) => ({
        ...pedido,
        customer: cliente,
        events: [],
        location: null,
        delivery: null,
        ...(include?.tenant ? { tenant: relacion(include.tenant, FILA_NEGOCIO) } : {}),
      })),
      update: vi.fn(async ({ data, include, select }: any) => {
        Object.assign(pedido, data);
        const inc = include ?? select;
        return {
          ...pedido,
          ...(inc?.customer ? { customer: cliente } : {}),
          ...(inc?.tenant ? { tenant: relacion(inc.tenant, FILA_NEGOCIO) } : {}),
        };
      }),
    },
    tenant: {
      findUnique: vi.fn(async ({ select }: any) =>
        select ? relacion({ select }, FILA_NEGOCIO) : { ...FILA_NEGOCIO },
      ),
    },
    orderEvent: { create: vi.fn(async () => ({})) },
  };
  const svc = new OrdersService(
    prisma as any,
    new ChannelsService(null as any),
    null as any,
    null as any,
    { broadcastOrderUpsert: vi.fn() } as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any, null as any,
  );
  return svc;
}

const DUENO = { id: 'u1', email: 'a@b.co', role: 'TENANT_OWNER', tenantId: 't1' } as AuthUser;

describe('aceptar el pago de un domicilio', () => {
  it('la respuesta no lleva ningún secreto del negocio', async () => {
    const r = await montar('PENDING').acceptDeliveryPayment(DUENO, 'o1');
    const json = JSON.stringify(r);
    expect(json).not.toContain(SECRETO);
    expect(json).not.toContain('growBusinessApiKey');
    expect(json).not.toContain('hot-123');
  });

  it('sigue dando el enlace al domiciliario', async () => {
    const r = await montar('PENDING').acceptDeliveryPayment(DUENO, 'o1');
    expect(r.courierConfigured).toBe(true);
    expect(r.courierLink.startsWith('https://wa.me/573170000000?')).toBe(true);
  });

  it('ya pagado: tampoco filtra nada, y dice bien si hay domiciliario', async () => {
    const r = await montar('PAID').acceptDeliveryPayment(DUENO, 'o1');
    expect(JSON.stringify(r)).not.toContain(SECRETO);
    expect(r.courierLink.startsWith('https://wa.me/573170000000?')).toBe(true);
    // Antes miraba `o.tenant`, que `get()` no carga: decía «sin domiciliario»
    // aunque el enlace saliera bien.
    expect(r.courierConfigured).toBe(true);
  });
});
