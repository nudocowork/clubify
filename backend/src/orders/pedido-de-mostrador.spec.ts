import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from './orders.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * LA VENTA DE MOSTRADOR: un pedido sin ficha de cliente.
 *
 * El cliente era obligatorio, así que para cobrarle a alguien que entra, pide y
 * se va había que registrarlo antes en la base. Empanadas La Parada —negocio de
 * Sellea— usa los pedidos como CAJA, para que la cocina los procese, y no
 * quiere fichar a cada persona. Pedido de Humberto en el Lab de Sellea
 * (2026-09-23): «solo quiere poder usar las órdenes como sistema de venta».
 *
 * LO QUE HAY QUE PROTEGER AQUÍ no es que el pedido se cree —eso se ve enseguida
 * si falla— sino lo que NO debe pasar cuando no hay ficha:
 *
 *  · que no se invente un cliente para salir del paso,
 *  · que no se acumulen sellos a nadie (es lo contrario de lo que se pidió),
 *  · que no salgan automatizaciones dirigidas a un cliente que no existe,
 *  · y que un pedido CON ficha siga comportándose exactamente igual que antes.
 */

const OWNER: AuthUser = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER' as any,
  tenantId: 'tenant-1',
};

function makePrisma() {
  const creados: any[] = [];
  return {
    creados,
    order: {
      findUnique: vi.fn(async (args: any) => (args?.where?.code ? null : null)),
      create: vi.fn(async (args: any) => {
        creados.push(args.data);
        return { id: 'order-1', ...args.data };
      }),
      update: vi.fn(async (args: any) => ({ id: 'order-1', ...args.data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    orderEvent: { create: vi.fn(async () => ({})) },
    event: { create: vi.fn(async () => ({})) },
    tenant: {
      findUnique: vi.fn(async () => ({
        id: 'tenant-1',
        status: 'ACTIVE',
        deliveryAlertsEnabled: false,
        currencySymbol: '$',
      })),
    },
    customer: {
      findUnique: vi.fn(async (args: any) =>
        args?.where?.id === 'cust-1'
          ? { id: 'cust-1', tenantId: 'tenant-1', fullName: 'Cliente', email: null }
          : null,
      ),
    },
    product: {
      findMany: vi.fn(async () => [
        {
          id: 'prod-1',
          tenantId: 'tenant-1',
          name: 'Empanada de queso',
          price: 3,
          isActive: true,
          variants: [],
          extras: [],
        },
      ]),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    card: { findMany: vi.fn(async () => [] as any[]), findUnique: vi.fn(async () => null) },
    pass: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'pass-1' })),
      update: vi.fn(async () => ({})),
    },
    stamp: {
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      findMany: vi.fn(async () => [] as any[]),
      count: vi.fn(async () => 0),
    },
    location: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    whiteLabel: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (ops: any) =>
      typeof ops === 'function' ? ops({}) : Promise.all(ops),
    ),
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const automations = { emit: vi.fn(async () => undefined) };
  const svc = new OrdersService(
    prisma as any,
    { generateWaMeCourier: vi.fn(() => '') } as any,
    { computeForCart: vi.fn(async () => ({ discount: 0, applied: [] })) } as any,
    automations as any,
    { broadcastOrderUpsert: vi.fn() } as any,
    { send: vi.fn(async () => undefined) } as any,
    { pushPassUpdate: vi.fn(async () => undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    {
      ensureForOrder: vi.fn(async () => undefined),
      notifyCompanyReadyForPickup: vi.fn(async () => undefined),
      markDelivered: vi.fn(async () => undefined),
      markCancelled: vi.fn(async () => undefined),
    } as any,
    { notify: vi.fn(async () => undefined) } as any,
    { enviarATenant: vi.fn(async () => ({ enviados: 0 })) } as any,
    { avisar: vi.fn(async () => undefined) } as any,
  );
  return { svc, automations };
}

const CARRITO = [{ productId: 'prod-1', qty: 2 }];

describe('un pedido SIN ficha de cliente', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
  });

  it('SE CREA, que es lo que no se podía hacer', async () => {
    const { svc } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, { items: CARRITO });

    expect(prisma.order.create).toHaveBeenCalled();
    expect(prisma.creados[0].customerId).toBeNull();
  });

  it('NO SE INVENTA NINGUNA FICHA para salir del paso', async () => {
    // La tentación fácil era crear un cliente «Mostrador» y colgarle todo. Eso
    // ensucia la base del negocio justo con lo que quería evitar.
    const { svc } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, { items: CARRITO });

    expect((prisma.customer as any).create).toBeUndefined();
    expect(prisma.customer.findUnique).not.toHaveBeenCalled();
  });

  it('guarda el nombre suelto, para que la cocina sepa de quién es', async () => {
    const { svc } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, {
      items: CARRITO,
      customerName: '  Juan de la mesa 5  ',
    });
    expect(prisma.creados[0].customerName).toBe('Juan de la mesa 5');
  });

  it('sin nombre, no se guarda una cadena vacía', async () => {
    // Una cadena vacía se pinta igual que un nombre de verdad y deja la
    // pantalla con un hueco. `null` es lo que la pantalla sabe leer.
    const { svc } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, { items: CARRITO, customerName: '   ' });
    expect(prisma.creados[0].customerName).toBeNull();
  });

  it('NO ACUMULA SELLOS NI DISPARA AUTOMATIZACIONES', async () => {
    // El corazón del pedido de Humberto: usar los pedidos como caja SIN
    // fidelizar a quien pasa por el mostrador. Y además no hay cliente al que
    // mandarle nada.
    const { svc, automations } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, {
      items: CARRITO,
      status: 'DELIVERED' as any,
    });

    expect(prisma.stamp.create).not.toHaveBeenCalled();
    expect(prisma.pass.update).not.toHaveBeenCalled();
    expect(automations.emit).not.toHaveBeenCalled();
  });
});

describe('un pedido CON ficha sigue igual que antes', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
  });

  it('se comprueba el cliente y se guarda su id', async () => {
    const { svc } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, {
      items: CARRITO,
      customerId: 'cust-1',
    });

    expect(prisma.customer.findUnique).toHaveBeenCalled();
    expect(prisma.creados[0].customerId).toBe('cust-1');
    // Con ficha, el nombre suelto no se duplica: el nombre es el de la ficha y
    // dos copias acaban contradiciéndose en cuanto alguien la edite.
    expect(prisma.creados[0].customerName).toBeNull();
  });

  it('SIGUE DISPARANDO sus automatizaciones', async () => {
    const { svc, automations } = makeService(prisma);
    await svc.createInternal(OWNER, undefined, {
      items: CARRITO,
      customerId: 'cust-1',
      status: 'CONFIRMED' as any,
    });
    expect(automations.emit).toHaveBeenCalledWith(
      'ORDER_CONFIRMED',
      expect.objectContaining({ customerId: 'cust-1' }),
    );
  });

  it('UN CLIENTE DE OTRO NEGOCIO SE SIGUE RECHAZANDO', () => {
    // Que el campo sea opcional no puede abrir la puerta a colgarle un pedido
    // al cliente de otro negocio. Es la comprobación que más importa de todo
    // este cambio.
    const { svc } = makeService(prisma);
    return expect(
      svc.createInternal(OWNER, undefined, {
        items: CARRITO,
        customerId: 'cust-de-otro',
      }),
    ).rejects.toThrow(/no existe en este negocio/i);
  });
});
