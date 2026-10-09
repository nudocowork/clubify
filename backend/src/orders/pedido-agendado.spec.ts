import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ChannelsService } from '../channels/channels.service';
import { OwnerOrderAlertService } from './owner-order-alert.service';

/**
 * PEDIDOS AGENDADOS E IDEMPOTENCIA en `createPublic`.
 *
 *  - Con la función encendida, un domicilio puede pedirse para otro día y
 *    hora, también con el negocio CERRADO ahora (es la razón de la función).
 *  - El servidor es la autoridad: función apagada, recoger/mesa, anticipación,
 *    máximo y horario se comprueban aquí aunque el selector ya los filtre.
 *  - El mismo intento de compra (`clientRequestId`) no crea dos pedidos, ni
 *    en un reintento ni en la carrera de dos envíos simultáneos.
 *  - Sin `scheduledFor` ni `clientRequestId`, el pedido es el de siempre.
 *
 * Prisma de mentira: no necesita base de datos.
 */

const HAMBURGUESERIA = [{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '18:00', hasta: '01:00' }];
const AGENDADOS_ON = { pedidosAgendados: { activo: true, anticipacionHoras: 48, diasMaximos: 30 } };

const TENANT = {
  id: 't1',
  slug: 'la-hamburgueseria',
  status: 'ACTIVE',
  brandName: 'La Hamburguesería',
  whatsappOrdersPhone: '+573001112233',
  currency: 'COP',
  currencySymbol: '$',
  whiteLabelId: null,
  timezone: 'America/Bogota',
  deliveryHours: HAMBURGUESERIA,
  storefront: { theme: AGENDADOS_ON },
};

const BURGER = {
  id: 'p-burger',
  tenantId: 't1',
  name: 'Hamburguesa',
  basePrice: 25000,
  isAvailable: true,
  availableForDelivery: true,
  locationMode: 'TODAS',
  variantPriceMode: 'DELTA',
  maxVariantsTotal: null,
  maxExtrasTotal: null,
  variants: [],
  extras: [],
};

const DIRECCION = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  phone: '+57 3001234567',
  departamento: 'Santander',
  municipio: 'Bucaramanga',
  direccion: 'Calle 45 #12-30',
};

const PEDIDO = {
  tenantSlug: 'la-hamburgueseria',
  customer: { fullName: 'Ana Ruiz', phone: '+57 3001234567' },
  items: [{ productId: 'p-burger', qty: 1 }],
  fulfillment: 'DELIVERY' as const,
  mode: 'DELIVERY' as const,
  deliveryAddress: DIRECCION,
};

/** Sábado 10 de octubre, 7:30 p. m. en Bogotá. */
const SABADO_1930 = '2026-10-11T00:30:00.000Z';
const ID = '6f1c2a9e-3b7d-4e21-9a55-0c8d7e6f5a41';

const sinEfecto: any = new Proxy(
  {},
  { get: (_t, k) => (k === 'then' ? undefined : async () => undefined) },
);

function montar(opts: { tenant?: Record<string, unknown>; yaCreado?: any } = {}) {
  const creados: any[] = [];
  const prisma: any = {
    tenant: { findUnique: vi.fn(async () => ({ ...TENANT, ...(opts.tenant ?? {}) })) },
    product: {
      findMany: vi.fn(async () => [BURGER]),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    customer: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (a: any) => ({ id: 'c1', ...a.data })),
    },
    order: {
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => opts.yaCreado ?? null),
      create: vi.fn(async (a: any) => {
        creados.push(a.data);
        return { id: `o${creados.length}`, ...a.data };
      }),
      update: vi.fn(async () => ({})),
    },
    event: { create: vi.fn(async () => ({})) },
    location: { findFirst: vi.fn(async () => null) },
    menu: { findFirst: vi.fn(async () => null) },
  };
  const svc = new OrdersService(
    prisma,
    new ChannelsService(null as any),
    { computeForCart: async () => ({ discount: 0, applied: [] }) } as any,
    sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
    sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
  );
  return { svc, prisma, creados };
}

const textoDe = (link: string) => decodeURIComponent(link.split('?text=')[1] ?? '');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Jueves 8 de octubre de 2026, mediodía en Bogotá: la hamburguesería
  // (6 p. m. a 1 a. m.) está CERRADA.
  vi.setSystemTime(new Date('2026-10-08T12:00:00-05:00'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pedido agendado', () => {
  it('CON EL NEGOCIO CERRADO se puede agendar, y se guarda el instante en UTC', async () => {
    const { svc, creados } = montar();
    const r = await svc.createPublic({ ...PEDIDO, scheduledFor: SABADO_1930 });
    expect(creados).toHaveLength(1);
    expect(creados[0].scheduledFor).toEqual(new Date(SABADO_1930));
    expect(r.scheduledFor).toEqual(new Date(SABADO_1930));
  });

  it('el WhatsApp al negocio dice para cuándo es, en su hora', async () => {
    const { svc } = montar();
    const r = await svc.createPublic({ ...PEDIDO, scheduledFor: SABADO_1930 });
    const texto = textoDe(r.whatsappLink);
    expect(texto).toContain('▸ *AGENDADO: sábado 10 de octubre · 7:30 p. m.*');
    // Justo debajo del número del pedido.
    expect(texto.split('\n')[1]).toContain('AGENDADO');
  });

  it('sin agendar y cerrado, el bloqueo de siempre sigue igual', async () => {
    const { svc, creados } = montar();
    await expect(svc.createPublic({ ...PEDIDO })).rejects.toThrow(
      /no está recibiendo pedidos a domicilio.*Vuelve hoy a las 6 p\. m\./s,
    );
    expect(creados).toHaveLength(0);
  });

  it('si el negocio APAGÓ la función, se dice claro', async () => {
    const { svc, creados } = montar({ tenant: { storefront: { theme: {} } } });
    await expect(svc.createPublic({ ...PEDIDO, scheduledFor: SABADO_1930 })).rejects.toThrow(
      'Este negocio ya no recibe pedidos agendados',
    );
    expect(creados).toHaveLength(0);
  });

  it('para recoger o en mesa no se agenda', async () => {
    const { svc } = montar();
    await expect(
      svc.createPublic({ ...PEDIDO, fulfillment: 'PICKUP', scheduledFor: SABADO_1930 } as any),
    ).rejects.toThrow('Solo se pueden agendar pedidos a domicilio.');
    await expect(
      svc.createPublic({ ...PEDIDO, fulfillment: 'DINE_IN', scheduledFor: SABADO_1930 } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('antes de la anticipación, fuera del horario o más allá del máximo: no', async () => {
    const { svc, creados } = montar();
    // Viernes 9, 7:30 p. m.: solo 31 h y media de anticipación.
    await expect(
      svc.createPublic({ ...PEDIDO, scheduledFor: '2026-10-10T00:30:00.000Z' }),
    ).rejects.toThrow(/al menos 2 días de anticipación/);
    // Sábado 10 a las 3 p. m.: el negocio abre a las 6.
    await expect(
      svc.createPublic({ ...PEDIDO, scheduledFor: '2026-10-10T20:00:00.000Z' }),
    ).rejects.toThrow(/no entrega domicilios/);
    // 9 de noviembre: más de 30 días.
    await expect(
      svc.createPublic({ ...PEDIDO, scheduledFor: '2026-11-10T00:30:00.000Z' }),
    ).rejects.toThrow(/hasta 30 días adelante/);
    expect(creados).toHaveLength(0);
  });

  it('sin `scheduledFor`, abierto, el pedido es el de siempre (null en las columnas nuevas)', async () => {
    vi.setSystemTime(new Date('2026-10-08T20:00:00-05:00'));
    const { svc, creados, prisma } = montar();
    const r = await svc.createPublic({ ...PEDIDO });
    expect(creados[0].scheduledFor).toBeNull();
    expect(creados[0].clientRequestId).toBeNull();
    expect(textoDe(r.whatsappLink)).not.toContain('AGENDADO');
    // Ni se busca un intento anterior.
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('el mismo intento de compra no crea dos pedidos', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-08T20:00:00-05:00')); // abierto
  });

  it('se guarda el id del intento', async () => {
    const { svc, creados } = montar();
    await svc.createPublic({ ...PEDIDO, clientRequestId: ID });
    expect(creados[0].clientRequestId).toBe(ID);
  });

  it('un REINTENTO devuelve el pedido ya creado, sin crear otro', async () => {
    const ya = { id: 'o-viejo', code: 'ABC123', tenantId: 't1', clientRequestId: ID, whatsappLink: 'https://wa.me/1?text=x' };
    const { svc, creados, prisma } = montar({ yaCreado: ya });
    const r = await svc.createPublic({ ...PEDIDO, clientRequestId: ID });
    expect(r.id).toBe('o-viejo');
    expect(r.whatsappLink).toBe('https://wa.me/1?text=x');
    expect(creados).toHaveLength(0);
    // Acotado por negocio: el id lo pone el navegador.
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ tenantId: 't1', clientRequestId: ID });
  });

  it('el reintento que llega con el negocio ya CERRADO devuelve el pedido, no «cerrado»', async () => {
    vi.setSystemTime(new Date('2026-10-09T02:00:00-05:00'));
    const ya = { id: 'o-viejo', code: 'ABC123', tenantId: 't1', clientRequestId: ID, whatsappLink: null };
    const { svc } = montar({ yaCreado: ya });
    const r = await svc.createPublic({ ...PEDIDO, clientRequestId: ID });
    expect(r.id).toBe('o-viejo');
    expect(r.whatsappLink).toBe('');
  });

  it('LA CARRERA: el segundo choca con el índice único y devuelve el del primero', async () => {
    const { svc, prisma } = montar();
    const delPrimero = { id: 'o-primero', code: 'PRIM01', tenantId: 't1', clientRequestId: ID, whatsappLink: 'https://wa.me/1' };
    // Al mirar al principio no hay nada (el primero aún no guardó)…
    prisma.order.findFirst
      .mockResolvedValueOnce(null)
      // …y tras chocar, ya está.
      .mockResolvedValueOnce(delPrimero);
    prisma.order.create.mockRejectedValueOnce(Object.assign(new Error('único'), { code: 'P2002' }));
    const r = await svc.createPublic({ ...PEDIDO, clientRequestId: ID });
    expect(r.id).toBe('o-primero');
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    // Sin repetir nada de lo que ya hizo el primero.
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('un P2002 por el CÓDIGO (no por el intento) se reintenta con otro código, como siempre', async () => {
    const { svc, prisma, creados } = montar();
    prisma.order.create.mockRejectedValueOnce(Object.assign(new Error('código'), { code: 'P2002' }));
    const r = await svc.createPublic({ ...PEDIDO, clientRequestId: ID });
    expect(prisma.order.create).toHaveBeenCalledTimes(2);
    expect(creados).toHaveLength(1);
    expect(r.id).toBe('o1');
  });

  it('un id con forma rara se ignora: el pedido entra como siempre', async () => {
    const { svc, creados, prisma } = montar();
    await svc.createPublic({ ...PEDIDO, clientRequestId: "x'; DROP" });
    expect(creados[0].clientRequestId).toBeNull();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});

describe('el aviso por SMS al negocio', () => {
  const svc = new OwnerOrderAlertService({} as any, {} as any) as any;
  const PEDIDO_SMS = {
    code: 'DAU9EJ',
    total: 52000,
    fulfillment: 'DELIVERY',
    tableNumber: null,
    customer: { fullName: 'Ana Ruiz' },
  };

  it('un pedido agendado EMPIEZA por «AGENDADO» con su fecha, en la hora del negocio', () => {
    const t: string = svc.texto(
      { ...PEDIDO_SMS, scheduledFor: new Date(SABADO_1930) },
      { currencySymbol: '$', timezone: 'America/Bogota', whiteLabel: null },
    );
    // Sin «·» ni tildes de 16 bits: el SMS sigue en GSM-7.
    expect(t.split('\n')[0]).toBe('AGENDADO - sab 10 oct - 7:30 p. m.');
    expect(t.split('\n')[1]).toBe('Nuevo pedido DAU9EJ');
    expect(t).not.toContain('·');
  });

  it('un pedido para ahora no cambia', () => {
    const t: string = svc.texto(PEDIDO_SMS, { currencySymbol: '$', whiteLabel: null });
    expect(t.startsWith('Nuevo pedido DAU9EJ')).toBe(true);
    expect(t).not.toContain('AGENDADO');
  });
});

describe('GET /orders/agendados', () => {
  function montarPanel(rol: string, sedeDelEmpleado: string | null = null) {
    const prisma: any = {
      tenant: { findUnique: vi.fn(async () => ({ timezone: 'America/Bogota' })) },
      user: { findUnique: vi.fn(async () => ({ locationId: sedeDelEmpleado })) },
      order: {
        findMany: vi.fn(async () => [{ id: 'o1', scheduledFor: new Date(SABADO_1930) }]),
        count: vi.fn(async () => 3),
      },
      storefront: { findUnique: vi.fn(async () => ({ theme: AGENDADOS_ON })) },
    };
    const svc = new OrdersService(
      prisma,
      sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
      sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
    );
    const user = { id: 'u1', role: rol, tenantId: 't1' } as any;
    return { svc, prisma, user };
  }

  it('solo los del negocio de quien mira, ordenados por la fecha pedida', async () => {
    const { svc, prisma, user } = montarPanel('TENANT_OWNER');
    const r = await svc.agendados(user, 'otro-negocio', 'hoy');
    const q = prisma.order.findMany.mock.calls[0][0];
    // El `tenantId` de la URL no vale para un dueño: manda su sesión.
    expect(q.where.tenantId).toBe('t1');
    expect(q.orderBy).toEqual({ scheduledFor: 'asc' });
    // «Hoy» = el día entero del negocio (jueves 8 en Bogotá).
    expect(q.where.AND).toContainEqual({
      scheduledFor: {
        gte: new Date('2026-10-08T05:00:00Z'),
        lt: new Date('2026-10-09T05:00:00Z'),
      },
    });
    expect(prisma.order.count.mock.calls[0][0].where.tenantId).toBe('t1');
    expect(r).toMatchObject({ zona: 'America/Bogota', filtro: 'hoy', activo: true, futuros: 3 });
  });

  it('un empleado «solo pedidos» ve los de su sede y los sin sede, igual que en el tablero', async () => {
    const { svc, prisma, user } = montarPanel('TENANT_ORDERS', 'sede-norte');
    await svc.agendados(user, undefined, 'todos', 'sede-sur');
    const and = prisma.order.findMany.mock.calls[0][0].where.AND;
    expect(and).toContainEqual({ OR: [{ locationId: 'sede-norte' }, { locationId: null }] });
    expect(and).not.toContainEqual({ locationId: 'sede-sur' });
  });

  it('un filtro desconocido cae a «todos», que incluye los atrasados sin entregar', async () => {
    const { svc, prisma, user } = montarPanel('TENANT_OWNER');
    const r = await svc.agendados(user, undefined, 'lo-que-sea');
    expect(r.filtro).toBe('todos');
    const and = prisma.order.findMany.mock.calls[0][0].where.AND;
    expect(JSON.stringify(and)).toContain('"notIn":["CANCELLED","DELIVERED"]');
  });
});
