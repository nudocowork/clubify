import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * El pedido a domicilio fuera del horario se rechaza EN EL SERVIDOR.
 *
 * No basta con esconder el carrito: el menú público se cachea unos minutos
 * —alguien puede tener abierta una página de cuando estaba abierto— y un POST
 * directo se salta cualquier botón. Esta es la comprobación que no se puede
 * saltar.
 */

const HAMBURGUESERIA = [{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '18:00', hasta: '01:00' }];

function servicio(negocio: Record<string, unknown>) {
  const prisma: any = { tenant: { findUnique: async () => negocio } };
  const nada = () => ({}) as any;
  return new OrdersService(
    prisma,
    nada(), nada(), nada(), nada(), nada(), nada(), nada(),
    nada(), nada(), nada(), nada(), nada(), nada(), nada(),
  );
}

const NEGOCIO = {
  id: 't1',
  slug: 'la-hamburgueseria',
  brandName: 'La Hamburguesería',
  status: 'ACTIVE',
  timezone: 'America/Bogota',
  deliveryHours: HAMBURGUESERIA,
  storefront: null,
  whiteLabel: null,
};

const pedido = (extra: Record<string, unknown> = {}) => ({
  tenantSlug: 'la-hamburgueseria',
  customer: { fullName: 'Ana', phone: '+573001234567' },
  items: [{ productId: 'p1', qty: 1 }],
  fulfillment: 'DELIVERY',
  ...extra,
});

/** Un instante de Bogotá (UTC-5 todo el año). */
const bogota = (iso: string) => new Date(`${iso}-05:00`);
const conReloj = async (iso: string, fn: () => Promise<unknown>) => {
  const Original = global.Date;
  const fijo = bogota(iso);
  // @ts-expect-error — reloj fijo solo durante la llamada.
  global.Date = class extends Original {
    constructor(...args: unknown[]) {
      // @ts-expect-error — delega en el original cuando le pasan argumentos.
      super(...(args.length ? args : [fijo]));
    }
    static now() {
      return fijo.getTime();
    }
  };
  try {
    return await fn();
  } finally {
    global.Date = Original;
  }
};

describe('pedido a domicilio fuera del horario', () => {
  it('AL MEDIODÍA se rechaza — el caso del reporte', async () => {
    const svc = servicio(NEGOCIO);
    await conReloj('2026-09-25T12:00', async () => {
      await expect(svc.createPublic(pedido() as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  it('y el mensaje dice cuándo volver, no solo que no', async () => {
    const svc = servicio(NEGOCIO);
    await conReloj('2026-09-25T12:00', async () => {
      await expect(svc.createPublic(pedido() as any)).rejects.toThrow(
        /no está recibiendo pedidos a domicilio.*Vuelve hoy a las 6 p\. m\./s,
      );
    });
  });

  it('dentro del horario pasa de largo esta comprobación', async () => {
    const svc = servicio(NEGOCIO);
    await conReloj('2026-09-25T20:00', async () => {
      // Sigue adelante y falla más tarde por otra cosa (el doble de prisma no
      // implementa el resto): lo que importa es que NO es el horario.
      await expect(svc.createPublic(pedido() as any)).rejects.not.toThrow(
        /no está recibiendo pedidos a domicilio/,
      );
    });
  });

  it('en MESA no se mira el horario: el cliente ya está dentro', async () => {
    const svc = servicio(NEGOCIO);
    await conReloj('2026-09-25T12:00', async () => {
      await expect(
        svc.createPublic(pedido({ fulfillment: 'DINE_IN' }) as any),
      ).rejects.not.toThrow(/no está recibiendo pedidos a domicilio/);
    });
  });

  it('un negocio SIN horario recibe a cualquier hora', async () => {
    const svc = servicio({ ...NEGOCIO, deliveryHours: null });
    await conReloj('2026-09-25T04:00', async () => {
      await expect(svc.createPublic(pedido() as any)).rejects.not.toThrow(
        /no está recibiendo pedidos a domicilio/,
      );
    });
  });

  it('un horario corrupto NO deja al negocio sin pedidos', async () => {
    // Prefiero recibir de más que dejar a un negocio sin poder vender por una
    // fila mal guardada.
    const svc = servicio({ ...NEGOCIO, deliveryHours: { vaya: 'basura' } });
    await conReloj('2026-09-25T12:00', async () => {
      await expect(svc.createPublic(pedido() as any)).rejects.not.toThrow(
        /no está recibiendo pedidos a domicilio/,
      );
    });
  });
});
