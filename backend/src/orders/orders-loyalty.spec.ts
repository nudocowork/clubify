import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrdersService } from './orders.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Regla de negocio (2026-08-20): el sello automático se gana al ENTREGAR el
 * pedido, nunca al confirmarlo — y un pedido cancelado no puede dejar
 * fidelización viva. Pasó en producción: se confirmaba el pedido, se daba el
 * sello, se cancelaba el pedido… y el sello quedaba regalado.
 *
 * Estos tests fijan la transición de estados para que un refactor futuro no
 * vuelva a adelantar el sello en silencio. Todo con Prisma mockeado: no
 * necesitan base de datos.
 */

const OWNER: AuthUser = {
  id: 'user-1',
  email: 'owner@test.com',
  role: 'OWNER' as any,
  tenantId: 'tenant-1',
};

/** Pedido base tal como lo devuelve prisma.order.findUnique en `get()`. */
function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    code: 'AB12',
    status: 'PENDING',
    fulfillment: 'PICKUP',
    total: 25000,
    paymentStatus: 'NOT_REQUIRED',
    paidAt: null,
    customer: { fullName: 'Cliente', phone: null, email: null },
    events: [],
    location: null,
    delivery: null,
    ...overrides,
  };
}

function stampCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    type: 'STAMPS',
    stampsRequired: 5,
    autoStampAmount: 1,
    pointsPerCurrency: null,
    ...overrides,
  };
}

function basePass(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pass-1',
    cardId: 'card-1',
    customerId: 'cust-1',
    stampsCount: 2,
    pointsBalance: 0,
    status: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Prisma falso: cada modelo expone vi.fn(). `order.findUnique` distingue la
 * búsqueda por código (anticolisión en create → null) de la búsqueda por id.
 * `$transaction` resuelve el array de promesas ya disparadas, igual que hace
 * Prisma con sus PrismaPromise.
 */
function makePrisma(order: ReturnType<typeof baseOrder>) {
  return {
    order: {
      findUnique: vi.fn(async (args: any) =>
        args?.where?.code ? null : order,
      ),
      update: vi.fn(async (args: any) => ({ ...order, ...args.data })),
      create: vi.fn(async () => ({ ...order })),
    },
    orderEvent: { create: vi.fn(async (_args: any) => ({})) },
    event: { create: vi.fn(async (_args: any) => ({})) },
    tenant: {
      // Sirve a la vez para assertTenantActive (status) y para los avisos
      // (deliveryAlertsEnabled false → salida temprana sin más queries).
      findUnique: vi.fn(async (_args: any) => ({
        id: 'tenant-1',
        status: 'ACTIVE',
        deliveryAlertsEnabled: false,
      })),
    },
    customer: {
      findUnique: vi.fn(async (_args: any) => ({
        id: 'cust-1',
        tenantId: 'tenant-1',
        fullName: 'Cliente',
        email: null,
      })),
    },
    card: {
      findMany: vi.fn(async (_args: any) => [] as any[]),
      findUnique: vi.fn(async (_args: any) => null as any),
    },
    pass: {
      findUnique: vi.fn(async (_args: any) => null as any),
      create: vi.fn(async (_args: any) => basePass()),
      update: vi.fn(async (_args: any) => ({})),
    },
    stamp: {
      create: vi.fn(async (_args: any) => ({})),
      update: vi.fn(async (_args: any) => ({})),
      findMany: vi.fn(async (_args: any) => [] as any[]),
      count: vi.fn(async (_args: any) => 0),
    },
    product: {
      findMany: vi.fn(async (_args: any) => [] as any[]),
      findUnique: vi.fn(async (_args: any) => null as any),
      update: vi.fn(async (_args: any) => ({})),
    },
    whiteLabel: { findUnique: vi.fn(async (_args: any) => null as any) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  const automations = { emit: vi.fn(async () => undefined) };
  const wallet = { pushPassUpdate: vi.fn(async () => undefined) };
  const gateway = { broadcastOrderUpsert: vi.fn() };
  const delivery = {
    ensureForOrder: vi.fn(async () => undefined),
    notifyCompanyReadyForPickup: vi.fn(async () => undefined),
    markDelivered: vi.fn(async () => undefined),
    markCancelled: vi.fn(async () => undefined),
  };
  const svc = new OrdersService(
    prisma as any,
    { generateWaMeCourier: vi.fn() } as any, // channels
    { computeForCart: vi.fn(async () => ({ discount: 0, applied: [] })) } as any, // promotions
    automations as any,
    gateway as any,
    { send: vi.fn(async () => undefined) } as any, // email
    wallet as any,
    {} as any, // appConfig
    {} as any, // growBusiness
    {} as any, // brand
    delivery as any,
    { notify: vi.fn(async () => undefined) } as any, // customerOrderSms
    { enviarATenant: vi.fn(async () => ({ enviados: 0 })) } as any, // appPush
  );
  return { svc, automations, wallet };
}

describe('sello automático por pedido — se gana al ENTREGAR, no antes', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PENDING → CONFIRMED: NO da sello aunque la tarjeta tenga auto-sello', async () => {
    prisma = makePrisma(baseOrder({ status: 'PENDING' }));
    prisma.card.findMany.mockResolvedValue([stampCard()] as any);
    const { svc, automations } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CONFIRMED');

    expect(prisma.stamp.create).not.toHaveBeenCalled();
    expect(prisma.pass.update).not.toHaveBeenCalled();
    // La automation de confirmación sí sigue saliendo — solo se movió el sello.
    expect(automations.emit).toHaveBeenCalledWith(
      'ORDER_CONFIRMED',
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });

  it('READY → DELIVERED: SÍ da el sello y actualiza el pase', async () => {
    prisma = makePrisma(baseOrder({ status: 'READY' }));
    prisma.card.findMany.mockResolvedValue([stampCard()] as any);
    prisma.pass.findUnique.mockResolvedValue(basePass() as any);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'DELIVERED');

    expect(prisma.stamp.create).toHaveBeenCalledTimes(1);
    const stampData = prisma.stamp.create.mock.calls[0][0].data;
    expect(stampData).toMatchObject({
      action: 'STAMP',
      orderId: 'order-1',
      passId: 'pass-1',
    });
    expect(prisma.pass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stampsCount: 3 }),
      }),
    );
  });

  it('DELIVERED de un pedido a DOMICILIO: sigue sin sello automático (PDF245)', async () => {
    prisma = makePrisma(
      baseOrder({ status: 'READY', fulfillment: 'DELIVERY' }),
    );
    prisma.card.findMany.mockResolvedValue([stampCard()] as any);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'DELIVERED');

    expect(prisma.stamp.create).not.toHaveBeenCalled();
  });

  it('crear desde el panel nacido CONFIRMED: NO da sello', async () => {
    prisma = makePrisma(baseOrder({ status: 'CONFIRMED' }));
    prisma.card.findMany.mockResolvedValue([stampCard()] as any);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        basePrice: 10000,
        variantPriceMode: 'DELTA',
        variants: [],
        extras: [],
      },
    ] as any);
    prisma.order.create.mockResolvedValue(
      baseOrder({ status: 'CONFIRMED' }) as any,
    );
    const { svc } = makeService(prisma);

    await svc.createInternal(OWNER, undefined, {
      customerId: 'cust-1',
      items: [{ productId: 'prod-1', qty: 1 }],
      status: 'CONFIRMED',
    });

    expect(prisma.stamp.create).not.toHaveBeenCalled();
  });

  it('crear desde el panel nacido DELIVERED (venta pasada): SÍ da sello', async () => {
    prisma = makePrisma(baseOrder({ status: 'DELIVERED' }));
    prisma.card.findMany.mockResolvedValue([stampCard()] as any);
    prisma.pass.findUnique.mockResolvedValue(basePass() as any);
    prisma.product.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        basePrice: 10000,
        variantPriceMode: 'DELTA',
        variants: [],
        extras: [],
      },
    ] as any);
    prisma.order.create.mockResolvedValue(
      baseOrder({ status: 'DELIVERED' }) as any,
    );
    const { svc } = makeService(prisma);

    await svc.createInternal(OWNER, undefined, {
      customerId: 'cust-1',
      items: [{ productId: 'prod-1', qty: 1 }],
      status: 'DELIVERED',
    });

    expect(prisma.stamp.create).toHaveBeenCalledTimes(1);
    expect(prisma.stamp.create.mock.calls[0][0].data.action).toBe('STAMP');
  });
});

describe('pedido cancelado — no deja fidelización viva', () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancelar un pedido que dio sello: crea STAMP_REMOVE y resta el contador', async () => {
    prisma = makePrisma(baseOrder({ status: 'CONFIRMED' }));
    // El pedido dejó un sello auto (flujo viejo o soporte de super admin).
    prisma.stamp.findMany.mockResolvedValue([
      {
        id: 'stamp-1',
        passId: 'pass-1',
        customerId: 'cust-1',
        action: 'STAMP',
        amount: 1,
      },
    ] as any);
    prisma.stamp.count.mockResolvedValue(0);
    prisma.pass.findUnique.mockResolvedValue(
      basePass({ stampsCount: 3 }) as any,
    );
    prisma.card.findUnique.mockResolvedValue({ stampsRequired: 5 } as any);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CANCELLED');

    // Movimiento inverso, ligado al MISMO pedido: el historial cuenta todo.
    expect(prisma.stamp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STAMP_REMOVE',
          orderId: 'order-1',
        }),
      }),
    );
    // El sello original pierde su purchaseAmount: esa venta no existió.
    expect(prisma.stamp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stamp-1' },
        data: { purchaseAmount: null },
      }),
    );
    expect(prisma.pass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stampsCount: 2 }),
      }),
    );
  });

  it('si el sello canceló completó el cartón, el pase vuelve a ACTIVE', async () => {
    prisma = makePrisma(baseOrder({ status: 'CONFIRMED' }));
    prisma.stamp.findMany.mockResolvedValue([
      {
        id: 'stamp-1',
        passId: 'pass-1',
        customerId: 'cust-1',
        action: 'STAMP',
        amount: 1,
      },
    ] as any);
    prisma.pass.findUnique.mockResolvedValue(
      basePass({ stampsCount: 5, status: 'COMPLETED' }) as any,
    );
    prisma.card.findUnique.mockResolvedValue({ stampsRequired: 5 } as any);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CANCELLED');

    expect(prisma.pass.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stampsCount: 4, status: 'ACTIVE' }),
      }),
    );
  });

  it('cancelar un pedido que dio puntos: POINTS_DEDUCT con piso en 0', async () => {
    prisma = makePrisma(baseOrder({ status: 'CONFIRMED' }));
    prisma.stamp.findMany.mockResolvedValue([
      {
        id: 'stamp-2',
        passId: 'pass-1',
        customerId: 'cust-1',
        action: 'POINTS_ADD',
        amount: 25,
      },
    ] as any);
    // El cliente ya gastó parte: solo quedan 10 pts. No se deja saldo negativo.
    prisma.pass.findUnique.mockResolvedValue(
      basePass({ pointsBalance: 10 }) as any,
    );
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CANCELLED');

    expect(prisma.stamp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'POINTS_DEDUCT' }),
      }),
    );
    const passUpdate = prisma.pass.update.mock.calls[0][0].data;
    expect(Number(passUpdate.pointsBalance)).toBe(0);
  });

  it('re-cancelación (soporte): el reverso es idempotente, no resta dos veces', async () => {
    prisma = makePrisma(baseOrder({ status: 'CONFIRMED' }));
    prisma.stamp.findMany.mockResolvedValue([
      {
        id: 'stamp-1',
        passId: 'pass-1',
        customerId: 'cust-1',
        action: 'STAMP',
        amount: 1,
      },
    ] as any);
    // Ya existe un reverso previo para este pedido.
    prisma.stamp.count.mockResolvedValue(1);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CANCELLED');

    expect(prisma.stamp.create).not.toHaveBeenCalled();
    expect(prisma.pass.update).not.toHaveBeenCalled();
  });

  it('cancelar un pedido sin sellos: no toca nada', async () => {
    prisma = makePrisma(baseOrder({ status: 'PENDING' }));
    prisma.stamp.findMany.mockResolvedValue([] as any);
    const { svc } = makeService(prisma);

    await svc.setStatus(OWNER, 'order-1', 'CANCELLED');

    expect(prisma.stamp.create).not.toHaveBeenCalled();
    expect(prisma.pass.update).not.toHaveBeenCalled();
  });
});
