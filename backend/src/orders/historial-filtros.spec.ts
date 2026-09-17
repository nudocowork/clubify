import { describe, it, expect, vi } from 'vitest';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * El Historial de pedidos: la sede del empleado y el rango de fechas.
 *
 * BUG 1 — buscar se saltaba la sede. La restricción de sede del empleado «solo
 * pedidos» iba en `where.OR`, y la búsqueda escribía OTRO `where.OR` encima.
 * Réplica real en La Gloriosa: un empleado veía 13 pedidos sin buscar y 160
 * buscando «a» — los de las cuatro sedes. Lo mismo en el CSV, que sale de la
 * misma consulta.
 *
 * BUG 2 — el filtro de fechas cortaba el día a las 19:00 de Colombia.
 * `new Date('2026-09-16')` es medianoche UTC y `setHours(23, 59)` usa la zona
 * del servidor. El 40 % de los pedidos se hacen entre las 19:00 y las 23:59:
 * «hoy» no enseñaba los pedidos de la noche, y sí los de la noche anterior.
 */

type Pedido = {
  id: string;
  code: string;
  tenantId: string;
  locationId: string | null;
  status: string;
  createdAt: Date;
  customer: { fullName: string; phone: string; email: string | null };
};

/** Evalúa los `where` de Prisma que usa `list()` sobre filas en memoria. */
function cumple(o: any, w: any): boolean {
  if (!w) return true;
  return Object.entries(w).every(([k, v]: [string, any]) => {
    if (k === 'AND') return (v as any[]).every((x) => cumple(o, x));
    if (k === 'OR') return (v as any[]).some((x) => cumple(o, x));
    if (k === 'customer') return cumple(o.customer, v.is);
    if (v instanceof Date || v === null || typeof v !== 'object') return o[k] === v;
    const val = o[k];
    if ('contains' in v) {
      const a = String(val ?? '');
      return v.mode === 'insensitive'
        ? a.toLowerCase().includes(String(v.contains).toLowerCase())
        : a.includes(v.contains);
    }
    if ('gte' in v && !(val >= v.gte)) return false;
    if ('gt' in v && !(val > v.gt)) return false;
    if ('lte' in v && !(val <= v.lte)) return false;
    if ('lt' in v && !(val < v.lt)) return false;
    return true;
  });
}

function prismaFalso(pedidos: Pedido[], opts: { sedeDelUsuario?: string | null; zona?: string } = {}) {
  return {
    user: { findUnique: vi.fn(async () => ({ locationId: opts.sedeDelUsuario ?? null })) },
    tenant: {
      findUnique: vi.fn(async () => ({ timezone: opts.zona ?? 'America/Bogota' })),
    },
    order: {
      findMany: vi.fn(async ({ where }: any) => pedidos.filter((o) => cumple(o, where))),
    },
  };
}

function servicio(prisma: any) {
  return new OrdersService(
    prisma,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any,
  );
}

const usuario = (role: string): AuthUser =>
  ({ id: 'u1', email: 'e@e.com', role, tenantId: 't1' }) as AuthUser;

const cliente = (fullName: string) => ({ fullName, phone: '+57 3000000000', email: null });

const pedido = (p: Partial<Pedido> & { id: string }): Pedido => ({
  code: p.id.toUpperCase(),
  tenantId: 't1',
  locationId: null,
  status: 'DELIVERED',
  createdAt: new Date('2026-09-16T17:00:00Z'),
  customer: cliente('Ana'),
  ...p,
});

describe('Historial — la búsqueda respeta la sede del empleado', () => {
  const PEDIDOS = [
    pedido({ id: 'suya', locationId: 'cabecera', customer: cliente('María') }),
    pedido({ id: 'sin-sede', locationId: null, customer: cliente('Juana') }),
    pedido({ id: 'ajena', locationId: 'florida', customer: cliente('Carla') }),
  ];

  it('buscando «a», un empleado «solo pedidos» NO ve los de otra sede', async () => {
    const prisma = prismaFalso(PEDIDOS, { sedeDelUsuario: 'cabecera' });
    const r = await servicio(prisma).list(usuario('TENANT_ORDERS'), undefined, {
      search: 'a',
    });
    expect(r.map((o: any) => o.id).sort()).toEqual(['sin-sede', 'suya']);
  });

  it('la búsqueda sigue buscando dentro de su sede', async () => {
    const prisma = prismaFalso(PEDIDOS, { sedeDelUsuario: 'cabecera' });
    const r = await servicio(prisma).list(usuario('TENANT_ORDERS'), undefined, {
      search: 'maría',
    });
    expect(r.map((o: any) => o.id)).toEqual(['suya']);
  });

  it('el CSV tampoco se salta la sede', async () => {
    const prisma = prismaFalso(PEDIDOS, { sedeDelUsuario: 'cabecera' });
    const ctrl = new OrdersController(servicio(prisma));
    let csv = '';
    const res = { setHeader: vi.fn(), send: (s: string) => (csv = s) } as any;
    await ctrl.export(usuario('TENANT_ORDERS'), res, undefined, undefined, 'a');
    expect(csv).toContain('SUYA');
    expect(csv).not.toContain('AJENA');
  });

  it('el dueño buscando ve todas las sedes, como siempre', async () => {
    const prisma = prismaFalso(PEDIDOS);
    const r = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      search: 'a',
    });
    expect(r).toHaveLength(3);
  });
});

describe('Historial — las fechas son días del NEGOCIO, no de UTC', () => {
  // 2026-09-16 en Bogotá (UTC-5) va de 05:00Z del 16 a 05:00Z del 17.
  const PEDIDOS = [
    pedido({ id: 'noche-anterior', createdAt: new Date('2026-09-16T04:30:00Z') }), // 15-09 23:30 Bogotá
    pedido({ id: 'madrugada', createdAt: new Date('2026-09-16T05:30:00Z') }), // 16-09 00:30
    pedido({ id: 'noche', createdAt: new Date('2026-09-17T04:30:00Z') }), // 16-09 23:30
    pedido({ id: 'dia-siguiente', createdAt: new Date('2026-09-17T05:30:00Z') }), // 17-09 00:30
  ];

  it('«desde 16 hasta 16» son los pedidos del 16 en Bogotá, incluida la noche', async () => {
    const prisma = prismaFalso(PEDIDOS);
    const r = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      from: '2026-09-16',
      to: '2026-09-16',
    });
    expect(r.map((o: any) => o.id).sort()).toEqual(['madrugada', 'noche']);
  });

  it('usa la zona del negocio: en Santiago (UTC-3 en septiembre) el día cambia a otra hora', async () => {
    // 04:30Z del 16 son las 01:30 del 16 en Santiago: ya es día 16 allí.
    const prisma = prismaFalso(PEDIDOS, { zona: 'America/Santiago' });
    const r = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      from: '2026-09-16',
      to: '2026-09-16',
    });
    expect(r.map((o: any) => o.id).sort()).toEqual(['madrugada', 'noche-anterior']);
  });

  it('una zona corrupta en la base no tumba el historial: se usa Bogotá', async () => {
    const prisma = prismaFalso(PEDIDOS, { zona: 'Marte/Olympus' });
    const r = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      from: '2026-09-16',
      to: '2026-09-16',
    });
    expect(r.map((o: any) => o.id).sort()).toEqual(['madrugada', 'noche']);
  });

  it('solo «desde» o solo «hasta» también van en hora del negocio', async () => {
    const prisma = prismaFalso(PEDIDOS);
    const desde = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      from: '2026-09-17',
    });
    expect(desde.map((o: any) => o.id)).toEqual(['dia-siguiente']);
    const hasta = await servicio(prisma).list(usuario('TENANT_OWNER'), undefined, {
      to: '2026-09-15',
    });
    expect(hasta.map((o: any) => o.id)).toEqual(['noche-anterior']);
  });
});
