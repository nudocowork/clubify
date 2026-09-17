import { describe, it, expect, vi } from 'vitest';
import { OwnerOrderAlertService } from './owner-order-alert.service';
import { ChannelsService } from '../channels/channels.service';
import { primerTelefono } from './primer-telefono';

/**
 * UN TELÉFONO GUARDADO COMO CADENA VACÍA NO PUEDE CORTAR LA CADENA.
 *
 * La Gloriosa tiene `whatsappPhone = ''` (no null) y `phone` bien puesto. La
 * cadena de destinos se armaba con `??`, que solo salta `null`/`undefined`: al
 * llegar a `''` se paraba ahí. Resultado, verificado en producción el
 * 2026-09-17: los pedidos de su sede sin número (UNICO Outlet) no le llegaban a
 * nadie — ni el SMS del servidor ni el enlace de WhatsApp del cliente.
 *
 * En producción hay 9 negocios con `whatsappPhone = ''`.
 */

type Opts = {
  tenant?: Record<string, unknown>;
  sede?: { ordersWhatsappPhone: string | null; adminPhone: string | null } | null;
  dueno?: string | null;
};

function prismaDelAviso(opts: Opts) {
  const eventos: any[] = [];
  const estado = { tenant: { ...opts.tenant } };
  const prisma = {
    order: {
      findUnique: vi.fn(async () => ({
        id: 'o1',
        code: 'GLO123',
        total: 32000,
        fulfillment: 'DELIVERY',
        tableNumber: null,
        tenantId: 't1',
        locationId: opts.sede ? 'sede-unico' : null,
        items: [],
        deliveryAddress: null,
        location: opts.sede ? { name: 'UNICO Outlet' } : null,
        customer: { fullName: 'Ana', phone: '+57 3001234567' },
      })),
    },
    tenant: {
      findUnique: vi.fn(async () => ({
        name: 'La Gloriosa',
        brandName: 'La Gloriosa',
        currency: 'COP',
        currencySymbol: '$',
        ownerOrderAlertsEnabled: true,
        ownerOrderAlertsPhone: null,
        ownerOrderAlertsAccountId: null,
        whatsappOrdersPhone: null,
        whatsappPhone: null,
        phone: null,
        growBusinessLocationId: 'loc-1',
        growBusinessApiKey: 'key-1',
        growBusinessSwitchNumber: null,
        whiteLabel: null,
        ...estado.tenant,
      })),
    },
    location: { findUnique: vi.fn(async () => opts.sede ?? null) },
    user: {
      findFirst: vi.fn(async () => (opts.dueno ? { phone: opts.dueno } : null)),
    },
    growBusinessAccount: { findFirst: vi.fn(async () => null) },
    event: {
      // Imita el filtro JSON de Prisma que usa el dedup:
      // `{ type, payload: { path: ['orderId'], equals } }`.
      findFirst: vi.fn(async ({ where }: any) => {
        const e = eventos.find(
          (x) =>
            x.tenantId === where.tenantId &&
            x.type === where.type &&
            x.payload?.orderId === where.payload?.equals,
        );
        return e ? { id: 'e' } : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        eventos.push(data);
        return data;
      }),
    },
  };
  return { prisma, eventos, estado };
}

function servicioDelAviso(opts: Opts) {
  const f = prismaDelAviso(opts);
  const grow = { sendSmsWithCreds: vi.fn(async () => ({ ok: true })) };
  const svc = new OwnerOrderAlertService(f.prisma as any, grow as any);
  return { svc, grow, ...f };
}

describe('aviso de pedido al negocio — la cadena de teléfonos', () => {
  it('La Gloriosa: `whatsappPhone = ""` no tapa el `phone` del negocio', async () => {
    // El caso real: sede sin número propio, WhatsApp del negocio vacío (no
    // null) y el teléfono general bien puesto.
    const { svc, grow } = servicioDelAviso({
      tenant: { whatsappPhone: '', phone: '+57 3181666999' },
      sede: { ordersWhatsappPhone: null, adminPhone: null },
    });
    await svc.avisar('o1');
    expect(grow.sendSmsWithCreds).toHaveBeenCalledTimes(1);
    expect((grow.sendSmsWithCreds.mock.calls[0] as any[])[1]).toBe('+57 3181666999');
  });

  it('el número de pedidos de la SEDE vacío cae al administrador de la sede', async () => {
    const { svc, grow } = servicioDelAviso({
      tenant: { whatsappOrdersPhone: '+57 3000000000' },
      sede: { ordersWhatsappPhone: '', adminPhone: '+57 3001112233' },
    });
    await svc.avisar('o1');
    expect((grow.sendSmsWithCreds.mock.calls[0] as any[])[1]).toBe('+57 3001112233');
  });

  it('un teléfono de solo espacios cuenta como vacío', async () => {
    const { svc, grow } = servicioDelAviso({
      tenant: { ownerOrderAlertsPhone: '   ', whatsappOrdersPhone: '+57 3009998877' },
    });
    await svc.avisar('o1');
    expect((grow.sendSmsWithCreds.mock.calls[0] as any[])[1]).toBe('+57 3009998877');
  });

  it('sin ningún teléfono deja rastro, y ese rastro NO bloquea avisar después', async () => {
    const f = servicioDelAviso({ tenant: { whatsappPhone: '', phone: '' } });
    await f.svc.avisar('o1');
    expect(f.grow.sendSmsWithCreds).not.toHaveBeenCalled();
    // Antes: `return` sin registrar nada, y el negocio que dice «no me llegó»
    // no tenía respuesta.
    const omitido = f.eventos.find((e) => e.payload?.orderId === 'o1');
    expect(omitido).toBeTruthy();
    expect(omitido.payload.motivo).toBe('sin_telefono');

    // El negocio pone su número y el aviso se reintenta: tiene que salir. Si
    // el rastro usara el tipo del dedup, el pedido quedaría «ya avisado» sin
    // que nadie hubiera recibido nada.
    f.estado.tenant.phone = '+57 3181666999';
    await f.svc.avisar('o1');
    expect(f.grow.sendSmsWithCreds).toHaveBeenCalledTimes(1);
  });
});

describe('primerTelefono', () => {
  it('salta null, undefined, vacío y espacios', () => {
    expect(primerTelefono(null, undefined, '', '   ', '+57 318 1666999')).toBe('+57 318 1666999');
  });

  it('salta lo que no tiene ni un dígito', () => {
    expect(primerTelefono('-', 'N/A', '3001234567')).toBe('3001234567');
  });

  it('respeta el orden: el primero utilizable gana', () => {
    expect(primerTelefono('3000000001', '3000000002')).toBe('3000000001');
  });

  it('sin ninguno utilizable devuelve null (no cadena vacía)', () => {
    expect(primerTelefono('', null, '  ')).toBeNull();
    expect(primerTelefono()).toBeNull();
  });
});

describe('enlace de WhatsApp del pedido — la cadena de teléfonos', () => {
  const svc = new ChannelsService(null as any);
  const order = {
    code: 'GLO123',
    items: [{ qty: 1, name: 'Hamburguesa', lineTotal: 32000, unitPrice: 32000 }],
    subtotal: 32000,
    discount: 0,
    total: 32000,
    fulfillment: 'PICKUP',
  } as any;
  const customer = { fullName: 'Ana', phone: '+57 3001234567' } as any;
  const base = { currency: 'COP', currencySymbol: '$' };

  it('La Gloriosa: sede sin número y `whatsappPhone = ""` → va al `phone`', () => {
    const link = svc.generateWaMeOwner(
      { ...base, whatsappOrdersPhone: null, whatsappPhone: '', phone: '+57 3181666999' } as any,
      order,
      customer,
      { name: 'UNICO Outlet', state: null, ordersWhatsappPhone: null, adminPhone: null } as any,
    );
    expect(link.startsWith('https://wa.me/573181666999?')).toBe(true);
  });

  it('el número de pedidos de la sede vacío no deja el enlace sin destino', () => {
    const link = svc.generateWaMeOwner(
      { ...base, whatsappOrdersPhone: '+57 3000000000' } as any,
      order,
      customer,
      { name: 'Centro', state: null, ordersWhatsappPhone: '', adminPhone: '' } as any,
    );
    expect(link.startsWith('https://wa.me/573000000000?')).toBe(true);
  });
});
