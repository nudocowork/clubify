import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from './orders.service';

/**
 * «¿Sumas sello?» — el sello que da el NEGOCIO a mano al entregar un pedido.
 *
 * EL BUG (desde el 2026-08-27): el botón respondía «El negocio no tiene
 * tarjeta de sellos activa» en TODOS los negocios. `stampOrderManually` solo
 * buscaba tarjetas con `autoStampOnOrder: true`, y esa casilla se apagó en
 * todas las tarjetas el 26-08 (commit 3b7f1293) precisamente para que el sello
 * lo diera el negocio con este botón. Se apagó el automático y, sin querer,
 * también el manual.
 *
 * Y su candado contra el doble clic era leer-decidir-escribir: dos clics
 * seguidos leían «0 sellos» a la vez y sellaban los dos.
 */

type Carta = {
  id: string;
  tenantId: string;
  isActive: boolean;
  autoStampOnOrder: boolean;
  type: string;
  clubPlanId: string | null;
  convenioId: string | null;
};

const TARJETA_SELLOS: Carta = {
  id: 'sellos',
  tenantId: 't1',
  isActive: true,
  autoStampOnOrder: false, // como TODAS en producción desde el 26-08
  type: 'STAMPS',
  clubPlanId: null,
  convenioId: null,
};
const TARJETA_CLUB: Carta = { ...TARJETA_SELLOS, id: 'club', clubPlanId: 'plan-1' };
const TARJETA_ALIANZA: Carta = { ...TARJETA_SELLOS, id: 'alianza', convenioId: 'conv-1' };

/** Filtra como Prisma para los `where` sencillos que usa el servicio. */
function cumple(fila: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && 'in' in v) return v.in.includes(fila[k]);
    return fila[k] === v;
  });
}

function prismaFalso(cartas: Carta[], sellosPrevios: any[] = []) {
  const sellos: any[] = [...sellosPrevios];
  const eventos = new Map<string, any>();
  const prisma = {
    sellos,
    order: {
      findFirst: vi.fn(async () => ({
        id: 'o1',
        customerId: 'c1',
        total: 25000,
        status: 'DELIVERED',
      })),
    },
    card: {
      findMany: vi.fn(async ({ where }: any) =>
        cartas
          .filter((c) => cumple(c, where))
          .map((c) => ({ ...c, stampsRequired: 10, autoStampAmount: 1, pointsPerCurrency: null })),
      ),
    },
    stamp: {
      count: vi.fn(async ({ where }: any) =>
        sellos.filter((s) => s.orderId === where.orderId && where.action.in.includes(s.action))
          .length,
      ),
      create: vi.fn(async ({ data }: any) => {
        sellos.push(data);
        return data;
      }),
    },
    pass: {
      findUnique: vi.fn(async ({ where }: any) => ({
        id: `pase-${where.cardId_customerId.cardId}`,
        stampsCount: 0,
        pointsBalance: 0,
        status: 'ACTIVE',
      })),
      create: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    event: {
      // La clave primaria de verdad: un segundo insert con el mismo id falla.
      create: vi.fn(async ({ data }: any) => {
        if (data.id && eventos.has(data.id)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        if (data.id) eventos.set(data.id, data);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const habia = eventos.delete(where.id);
        return { count: habia ? 1 : 0 };
      }),
    },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return prisma;
}

function servicio(prisma: any) {
  return new OrdersService(
    prisma,
    null as any,
    null as any,
    { emit: vi.fn(async () => undefined) } as any,
    null as any,
    null as any,
    { pushPassUpdate: vi.fn(async () => undefined) } as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
}

describe('«¿Sumas sello?» — sello manual del negocio', () => {
  it('SÍ sella aunque la tarjeta tenga el automático apagado', async () => {
    const prisma = prismaFalso([TARJETA_SELLOS]);
    const r = await servicio(prisma).stampOrderManually('t1', 'o1');
    expect(r.stamped).toBe(true);
    expect(prisma.sellos.filter((s) => s.action === 'STAMP')).toHaveLength(1);
  });

  it('no sella en la tarjeta de CLUB ni en la de ALIANZA', async () => {
    const prisma = prismaFalso([TARJETA_SELLOS, TARJETA_CLUB, TARJETA_ALIANZA]);
    const r = await servicio(prisma).stampOrderManually('t1', 'o1');
    expect(r).toMatchObject({ stamped: true, cards: 1 });
    const pases = prisma.sellos.map((s) => s.passId);
    expect(pases).toEqual(['pase-sellos']);
  });

  it('con solo tarjetas de club o alianza, dice que no hay tarjeta de sellos', async () => {
    const prisma = prismaFalso([TARJETA_CLUB, TARJETA_ALIANZA]);
    const r = await servicio(prisma).stampOrderManually('t1', 'o1');
    expect(r.stamped).toBe(false);
    expect(prisma.sellos).toHaveLength(0);
  });

  it('un doble clic NO da dos sellos', async () => {
    // Con el automático ENCENDIDO a propósito: así esta prueba mide solo la
    // carrera, y también falla con el código viejo (que sí veía esa tarjeta).
    const prisma = prismaFalso([{ ...TARJETA_SELLOS, autoStampOnOrder: true }]);
    const svc = servicio(prisma);
    const [a, b] = await Promise.all([
      svc.stampOrderManually('t1', 'o1'),
      svc.stampOrderManually('t1', 'o1'),
    ]);
    expect(prisma.sellos.filter((s) => s.action === 'STAMP')).toHaveLength(1);
    expect([a.stamped, b.stamped].sort()).toEqual([false, true]);
  });

  it('un segundo clic, ya sellado, tampoco', async () => {
    const prisma = prismaFalso([TARJETA_SELLOS]);
    const svc = servicio(prisma);
    await svc.stampOrderManually('t1', 'o1');
    const r = await svc.stampOrderManually('t1', 'o1');
    expect(r.stamped).toBe(false);
    expect(prisma.sellos.filter((s) => s.action === 'STAMP')).toHaveLength(1);
  });

  it('si el sello se revirtió (pedido reabierto por soporte), se puede volver a sellar', async () => {
    const prisma = prismaFalso(
      [TARJETA_SELLOS],
      [
        { orderId: 'o1', action: 'STAMP' },
        { orderId: 'o1', action: 'STAMP_REMOVE' },
      ],
    );
    const r = await servicio(prisma).stampOrderManually('t1', 'o1');
    expect(r.stamped).toBe(true);
  });

  it('si no se pudo sellar, el candado se suelta para poder reintentar', async () => {
    const prisma = prismaFalso([TARJETA_SELLOS]);
    const svc = servicio(prisma);
    prisma.pass.findUnique.mockRejectedValueOnce(new Error('BD caída'));
    const r1 = await svc.stampOrderManually('t1', 'o1');
    expect(r1.stamped).toBe(false);
    const r2 = await svc.stampOrderManually('t1', 'o1');
    expect(r2.stamped).toBe(true);
  });
});
