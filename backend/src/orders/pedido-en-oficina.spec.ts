import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ChannelsService } from '../channels/channels.service';
import { direccionDeOficina, oficinaDelPedido } from './pedido-en-oficina';

/**
 * PEDIDOS DESDE EL ENLACE DE UNA OFICINA.
 *
 * Nudo Cowork tiene varias oficinas y un menú en cada una. Quien pide desde
 * NUDO ESTUDIO tiene que pedir sin escribir una dirección de calle, y el
 * negocio tiene que recibir el pedido CON la oficina. Antes el enlace abría la
 * carta, pero el checkout exigía dirección y el nombre de la oficina no
 * llegaba a ninguna parte: ni al pedido ni al WhatsApp.
 *
 * Y tan importante como eso: sin `oficinaId` todo es exactamente lo de antes.
 * El último bloque lo fija con el mensaje entero.
 *
 * Prisma de mentira: no necesita base de datos.
 */

const TENANT = {
  id: 't1',
  slug: 'nudocowork',
  status: 'ACTIVE',
  brandName: 'Nudo Cowork',
  whatsappOrdersPhone: '+573189399844',
  currency: 'COP',
  currencySymbol: '$',
  whiteLabelId: null,
  storefront: { theme: {} },
};

const CAPUCHINO = {
  id: 'p-cafe',
  tenantId: 't1',
  name: 'Capuchino',
  basePrice: 9000,
  isAvailable: true,
  availableForDelivery: true,
  locationMode: 'TODAS',
  variantPriceMode: 'DELTA',
  maxVariantsTotal: null,
  maxExtrasTotal: null,
  variants: [],
  extras: [],
};

const NUDO_ESTUDIO = { id: 'carta-estudio', name: 'Nudo Estudio' };

const PEDIDO = {
  tenantSlug: 'nudocowork',
  customer: { fullName: 'Laura Gómez', phone: '+57 3001234567' },
  items: [{ productId: 'p-cafe', qty: 2 }],
  fulfillment: 'DELIVERY' as const,
  mode: 'DELIVERY' as const,
};

/** Lo que el pedido solo avisa: push, SMS, automatizaciones, correo… */
const sinEfecto: any = new Proxy(
  {},
  // `then` fuera: si no, un `await` sobre el objeto lo tomaría por promesa.
  { get: (_t, k) => (k === 'then' ? undefined : async () => undefined) },
);

function montar(carta: { id: string; name: string } | null = NUDO_ESTUDIO) {
  const creados: any[] = [];
  const prisma: any = {
    tenant: { findUnique: vi.fn(async () => TENANT) },
    product: {
      findMany: vi.fn(async () => [CAPUCHINO]),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    customer: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (a: any) => ({ id: 'c1', ...a.data })),
    },
    order: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (a: any) => {
        creados.push(a.data);
        return { id: 'o1', ...a.data };
      }),
      update: vi.fn(async () => ({})),
    },
    event: { create: vi.fn(async () => ({})) },
    location: { findFirst: vi.fn(async () => null) },
    menu: { findFirst: vi.fn(async () => carta) },
  };
  const svc = new OrdersService(
    prisma,
    // El de verdad: lo que se prueba es el texto que le llega al negocio.
    new ChannelsService(null as any),
    { computeForCart: async () => ({ discount: 0, applied: [] }) } as any,
    sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
    sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto, sinEfecto,
  );
  return { svc, prisma, creados };
}

const textoDe = (link: string) =>
  decodeURIComponent(link.split('?text=')[1] ?? '');

describe('pedido desde el enlace de una oficina', () => {
  it('guarda la oficina como destino del pedido', async () => {
    const { svc, creados } = montar();
    await svc.createPublic({ ...PEDIDO, oficinaId: 'carta-estudio' });
    expect(creados).toHaveLength(1);
    expect(creados[0].fulfillment).toBe('DELIVERY');
    expect(creados[0].mode).toBe('DELIVERY');
    expect(creados[0].deliveryAddress).toEqual({
      oficina: { id: 'carta-estudio', nombre: 'Nudo Estudio' },
      direccion: 'Nudo Estudio',
      phone: '+57 3001234567',
    });
  });

  it('no le exige dirección al cliente, y no se fía de la que llegue', async () => {
    // El destino lo pone el servidor: si valiera lo que manda el navegador,
    // cualquiera podría escribir otra oficina —o una calle— en este enlace.
    const { svc, creados } = montar();
    await svc.createPublic({
      ...PEDIDO,
      oficinaId: 'carta-estudio',
      deliveryAddress: { direccion: 'Calle falsa 123', municipio: 'Bogotá' },
    });
    expect(creados[0].deliveryAddress.direccion).toBe('Nudo Estudio');
    expect(creados[0].deliveryAddress.municipio).toBeUndefined();
  });

  it('la carta tiene que ser de ESTE negocio, estar encendida y no tener sede', async () => {
    // El id viaja en un enlace público: una carta de otro negocio no puede
    // poner su nombre en un pedido de este. Y una carta con sede es la de esa
    // sede: aceptarla como oficina dejaba pedir a domicilio sin dirección con
    // solo cambiar `?sede=` por `?oficina=` (Fable, 15-09-2026).
    const { svc, prisma } = montar();
    await svc.createPublic({ ...PEDIDO, oficinaId: 'carta-estudio' });
    expect(prisma.menu.findFirst.mock.calls[0][0].where).toEqual({
      id: 'carta-estudio',
      tenantId: 't1',
      isActive: true,
      locationId: null,
    });
  });

  it('una oficina que ya no existe no deja entrar un pedido sin destino', async () => {
    const { svc, creados } = montar(null);
    await expect(
      svc.createPublic({ ...PEDIDO, oficinaId: 'carta-borrada' }),
    ).rejects.toThrow(BadRequestException);
    expect(creados).toHaveLength(0);
  });

  it('el mensaje de WhatsApp lleva el pedido Y la oficina', async () => {
    const { svc } = montar();
    const r = await svc.createPublic({ ...PEDIDO, oficinaId: 'carta-estudio' });
    // Al número de pedidos del negocio, como cualquier pedido sin sede.
    expect(r.whatsappLink.startsWith('https://wa.me/573189399844?')).toBe(true);
    const texto = textoDe(r.whatsappLink);
    expect(texto).toContain('▸ Oficina: Nudo Estudio');
    expect(texto).toContain('▸ Entrega en la oficina');
    expect(texto).toContain('2x Capuchino');
    expect(texto).toContain('Laura Gómez');
    // Sin el bloque de dirección de calle: repetiría nombre y teléfono y
    // pintaría la oficina como si fuera una calle.
    expect(texto).not.toContain('Dirección de envío');
    expect(texto).not.toContain('▸ Domicilio');
  });
});

describe('sin oficina, el pedido es el de siempre', () => {
  const appUrlAntes = process.env.APP_URL;
  beforeEach(() => {
    process.env.APP_URL = 'https://app.soyclubify.com';
  });
  afterEach(() => {
    if (appUrlAntes === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrlAntes;
  });

  it('a domicilio sin dirección se sigue rechazando', async () => {
    const { svc, prisma } = montar();
    await expect(svc.createPublic({ ...PEDIDO })).rejects.toThrow(
      'Falta dirección',
    );
    expect(prisma.menu.findFirst).not.toHaveBeenCalled();
  });

  it('la dirección del cliente se guarda tal cual y el mensaje no nombra oficina', async () => {
    const { svc, prisma, creados } = montar();
    const direccion = {
      firstName: 'Laura',
      lastName: 'Gómez',
      phone: '+57 3001234567',
      departamento: 'Santander',
      municipio: 'Bucaramanga',
      direccion: 'Calle 45 #12-30',
    };
    const r = await svc.createPublic({ ...PEDIDO, deliveryAddress: direccion });
    expect(creados[0].deliveryAddress).toEqual(direccion);
    expect(prisma.menu.findFirst).not.toHaveBeenCalled();
    const texto = textoDe(r.whatsappLink);
    expect(texto).toContain('Dirección de envío');
    expect(texto).toContain('▸ Domicilio');
    expect(texto).not.toContain('Oficina');
  });

  it('para recoger, un oficinaId no cambia nada', async () => {
    const { svc, prisma, creados } = montar();
    await svc.createPublic({
      ...PEDIDO,
      fulfillment: 'PICKUP',
      oficinaId: 'carta-estudio',
    });
    expect(prisma.menu.findFirst).not.toHaveBeenCalled();
    expect(creados[0].deliveryAddress).toBeNull();
  });

  it('el mensaje de un pedido a domicilio es EXACTAMENTE el de antes', () => {
    // Capturado del código ANTERIOR a las oficinas. Si esto cambia sin
    // querer, les cambió el mensaje a todos los negocios que no tienen
    // oficinas, que son casi todos.
    const texto = textoDe(
      new ChannelsService(null as any).generateWaMeOwner(
        TENANT as any,
        {
          code: 'CBR6',
          items: [
            { qty: 1, name: 'Oreo (Pequeño)', lineTotal: 21500, unitPrice: 21500 },
          ],
          subtotal: 21500,
          discount: 0,
          total: 21500,
          fulfillment: 'DELIVERY',
          tableNumber: null,
          deliveryAddress: {
            firstName: 'QA',
            lastName: 'Test',
            phone: '+57 3150621706',
            departamento: 'Bogotá D.C.',
            municipio: 'Bogotá',
            direccion: 'Calle 123 #45-67',
          },
          customerNote: 'Sin azúcar',
          customerPaymentMethod: 'TRANSFERENCIA',
          customerPaymentOther: null,
        } as any,
        { fullName: 'QA Test', phone: '+57 3150621706' } as any,
      ),
    );
    expect(texto).toMatchInlineSnapshot(`
      "★ *Pedido #CBR6*
      QA Test · +57 3150621706
      • 1x Oreo (Pequeño) — $ 21.500
      Subtotal: $ 21.500
      *Total: $ 21.500*
      ▸ Domicilio
      ▸ Pago: transferencia
      *▸ Dirección de envío:*
      QA Test
      ☎ +57 3150621706
      Bogotá, Bogotá D.C.
      ▸ Calle 123 #45-67
      ✎ Sin azúcar
      Ver pedido: https://app.soyclubify.com/o/CBR6"
    `);
  });
});

describe('la oficina guardada en el pedido', () => {
  it('los pedidos de siempre no tienen oficina', () => {
    expect(oficinaDelPedido(null)).toBeNull();
    expect(oficinaDelPedido('Cra 1 con 23')).toBeNull();
    expect(oficinaDelPedido({ direccion: 'Calle 45 #12-30' })).toBeNull();
  });

  it('sin teléfono no se inventa uno', () => {
    expect(
      direccionDeOficina({ id: 'x', nombre: 'Sala 2' }, { phone: '  ' }),
    ).toEqual({ oficina: { id: 'x', nombre: 'Sala 2' }, direccion: 'Sala 2' });
  });
});
