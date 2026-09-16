import { describe, it, expect, vi } from 'vitest';
import { DeliveryService } from './delivery.service';

/**
 * A UN PEDIDO DE OFICINA NO SE LE CREA SEGUIMIENTO DE DOMICILIO.
 *
 * El pedido #YD6J7P de Nudo Cowork se hizo desde el menú de «Sala de Juntas»:
 * se entrega dentro del coworking, andando. Pero sale del menú de domicilio,
 * así que es `fulfillment = DELIVERY` y `ensureForOrder` le creaba su
 * seguimiento igual que a cualquier otro: el cliente veía «Buscando
 * repartidor» y los cinco pasos, y a la empresa de domicilios (DOMIRED) le
 * entraba un aviso de un pedido que nadie va a recoger.
 *
 * La condición miraba solo el modo del pedido. Ahora mira también si hay
 * oficina, que es lo que de verdad decide si existe un repartidor.
 *
 * No necesita base de datos.
 */

const OFICINA = {
  oficina: { id: 'carta-sala', nombre: 'Sala de Juntas' },
  direccion: 'Sala de Juntas',
};
const CALLE = { direccion: 'Cra. 1 #23-45', municipio: 'Bogotá' };

function servicio(deliveryAddress: unknown) {
  const create = vi.fn(async ({ data }: any) => ({ id: 'd1', ...data }));
  const svc = Object.create(DeliveryService.prototype) as any;
  svc.prisma = {
    order: {
      findUnique: vi.fn(async () => ({
        id: 'o1',
        tenantId: 't1',
        fulfillment: 'DELIVERY',
        mode: 'DELIVERY',
        deliveryAddress,
        deliveryAmount: null,
        delivery: null,
      })),
    },
    deliveryCompanyTenant: { count: vi.fn(async () => 1) },
    delivery: { create },
  };
  // Si algo revienta por dentro, `ensureForOrder` lo traga y avisa. Sin esto,
  // un fallo tonto se vería igual que «no creó el seguimiento» y la prueba
  // pasaría por el motivo equivocado.
  svc.logger = {
    log: () => {},
    warn: (m: string) => {
      throw new Error(`no debería avisar de nada: ${m}`);
    },
  };
  svc.resolveDefaultCompany = vi.fn(async () => 'domired');
  return { svc, create };
}

/**
 * El mismo candado, pero en el OTRO camino: marcar el pedido «listo».
 *
 * Los pedidos de oficina anteriores a este arreglo ya tienen su `Delivery`
 * creado en la base (hoy son tres en producción), así que cortar solo al
 * crearlo no basta: al marcarlos listos, la empresa de domicilios recibía un
 * «listo para recoger» con dirección «Sala de Juntas».
 */
function servicioParaAvisar(deliveryAddress: unknown) {
  const notify = vi.fn(async () => {});
  const svc = Object.create(DeliveryService.prototype) as any;
  svc.prisma = {
    delivery: {
      findUnique: vi.fn(async () => ({
        deliveryCompanyId: 'domired',
        tenantId: 't1',
      })),
    },
    order: { findUnique: vi.fn(async () => ({ deliveryAddress })) },
  };
  svc.logger = {
    log: () => {},
    warn: (m: string) => {
      throw new Error(`no debería avisar de nada: ${m}`);
    },
  };
  svc.resolveDefaultCompany = vi.fn(async () => 'domired');
  svc.notifyCompanyNewDelivery = notify;
  return { svc, notify };
}

describe('avisar a la empresa de que el pedido está listo', () => {
  it('a un pedido de OFICINA no se le avisa: no hay quién lo recoja', async () => {
    const { svc, notify } = servicioParaAvisar(OFICINA);
    await svc.notifyCompanyReadyForPickup('o1');
    expect(notify).not.toHaveBeenCalled();
  });

  it('a un domicilio de verdad se le sigue avisando', async () => {
    const { svc, notify } = servicioParaAvisar(CALLE);
    await svc.notifyCompanyReadyForPickup('o1');
    expect(notify).toHaveBeenCalledWith('domired', 'o1');
  });
});

describe('el seguimiento del domicilio', () => {
  it('NO se crea para un pedido entregado en una oficina', async () => {
    const { svc, create } = servicio(OFICINA);
    await svc.ensureForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });

  it('se sigue creando para un domicilio de verdad', async () => {
    const { svc, create } = servicio(CALLE);
    await svc.ensureForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.deliveryCompanyId).toBe('domired');
  });

  it('un pedido sin dirección todavía es un domicilio', async () => {
    const { svc, create } = servicio(null);
    await svc.ensureForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('«Mis pedidos» (la lista por teléfono)', () => {
  function servicioLista(rows: any[]) {
    const svc = Object.create(DeliveryService.prototype) as any;
    svc.prisma = {
      tenant: { findUnique: vi.fn(async () => ({ id: 't1', status: 'ACTIVE' })) },
      order: { findMany: vi.fn(async () => rows) },
    };
    return svc;
  }
  const FILA = {
    code: 'YD6J7P',
    status: 'PENDING',
    fulfillment: 'DELIVERY',
    mode: 'DELIVERY',
    total: 20000,
    createdAt: new Date('2026-09-16'),
    delivery: { status: 'WAITING_COURIER', etaMinutes: null, courierName: null },
  };

  it('un pedido de oficina no enseña «Buscando repartidor»', async () => {
    const svc = servicioLista([{ ...FILA, deliveryAddress: OFICINA }]);
    const r = await svc.listPublicByPhone('nudocowork', '3150621706');
    expect(r.orders[0].delivery).toBeNull();
    expect(r.orders[0].code).toBe('YD6J7P');
  });

  it('un domicilio normal sigue enseñando su estado', async () => {
    const svc = servicioLista([{ ...FILA, deliveryAddress: CALLE }]);
    const r = await svc.listPublicByPhone('cafe', '3150621706');
    expect(r.orders[0].delivery?.status).toBe('WAITING_COURIER');
  });
});
