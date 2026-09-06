import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * El empleado «solo pedidos» ve ÚNICAMENTE los de su sede.
 *
 * Reportado por un negocio: le asignaban una sede a un empleado de pedidos y
 * seguía viendo los de todas. La causa era que `list()` solo miraba el
 * parámetro `locationId` de la URL — el que pone el frontend—, nunca la sede
 * del empleado. Bastaba con no mandar el filtro para verlo todo, y llamando a
 * la API a pelo era trivial.
 *
 * Esta prueba fija las cuatro reglas. La tercera es tan importante como las
 * otras: `TENANT_STAFF` NO se filtra a propósito.
 */

/** Prisma de mentira: solo apunta con qué `where` se le llamó. */
function prismaFalso(opts: {
  sedeDelUsuario?: string | null;
  sedeDelPedido?: string | null;
  tenantDelPedido?: string;
}) {
  const llamadas: { where: any }[] = [];
  return {
    llamadas,
    prisma: {
      user: {
        findUnique: async () => ({ locationId: opts.sedeDelUsuario ?? null }),
      },
      order: {
        findMany: async (args: any) => {
          llamadas.push({ where: args.where });
          return [];
        },
        findUnique: async () => ({
          id: 'o1',
          tenantId: opts.tenantDelPedido ?? 't1',
          locationId: opts.sedeDelPedido ?? null,
        }),
      },
    },
  };
}

function servicio(prisma: any) {
  // `list` y `get` solo tocan prisma; el resto de dependencias no se usan.
  return new OrdersService(
    prisma,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any, null as any, null as any,
    null as any, null as any, null as any,
  );
}

const usuario = (role: string): AuthUser =>
  ({ id: 'u1', email: 'e@e.com', role, tenantId: 't1' }) as AuthUser;

describe('pedidos que ve cada empleado', () => {
  it('«solo pedidos» con sede: se le fuerza SU sede', async () => {
    const f = prismaFalso({ sedeDelUsuario: 'sede-a' });
    await servicio(f.prisma).list(usuario('TENANT_ORDERS'), undefined);
    expect(f.llamadas[0].where.OR).toContainEqual({ locationId: 'sede-a' });
  });

  it('«solo pedidos» no puede pedir OTRA sede por la URL', async () => {
    // Es el caso que importa: el filtro lo pone el frontend, así que sin esto
    // bastaba con cambiarlo a mano para ver la sede de al lado.
    const f = prismaFalso({ sedeDelUsuario: 'sede-a' });
    await servicio(f.prisma).list(usuario('TENANT_ORDERS'), undefined, {
      locationId: 'sede-b',
    });
    expect(f.llamadas[0].where.OR).toContainEqual({ locationId: 'sede-a' });
    expect(f.llamadas[0].where.locationId).toBeUndefined();
  });

  it('ve TAMBIÉN los pedidos sin sede — la incidencia del 2026-09-06', async () => {
    // 89 pedidos de la plataforma no tienen sede: son de antes de que el
    // negocio la tuviera, o de negocios que no usan sedes. Filtrarlos fuera
    // dejó a los empleados sin poder confirmar los pedidos del día anterior.
    const f = prismaFalso({ sedeDelUsuario: 'sede-a' });
    await servicio(f.prisma).list(usuario('TENANT_ORDERS'), undefined);
    expect(f.llamadas[0].where.OR).toEqual([
      { locationId: 'sede-a' },
      { locationId: null },
    ]);
  });

  it('puede confirmar un pedido sin sede', async () => {
    // `setStatus` entra por `get`, asi que bloquear aqui es «lo veo pero no lo
    // puedo confirmar» — peor que no verlo.
    const f = prismaFalso({ sedeDelUsuario: 'sede-a', sedeDelPedido: null });
    const o = await servicio(f.prisma).get(usuario('TENANT_ORDERS'), 'o1');
    expect(o.id).toBe('o1');
  });

  it('«solo pedidos» SIN sede asignada sigue viéndolos todos', async () => {
    const f = prismaFalso({ sedeDelUsuario: null });
    await servicio(f.prisma).list(usuario('TENANT_ORDERS'), undefined);
    expect(f.llamadas[0].where.locationId).toBeUndefined();
  });

  it('el empleado normal NO se filtra: es a propósito', async () => {
    // `TENANT_STAFF` también tiene sede, pero ese campo nació para los rankings
    // de sellos, no para restringir. Hay 52 empleados en 18 negocios con sede
    // puesta que hoy ven todos los pedidos; apagárselo de golpe sería cambiarles
    // el trabajo sin avisar. Si algún día se decide, que sea una decisión, no un
    // efecto colateral — y esta prueba obliga a que alguien la borre a mano.
    const f = prismaFalso({ sedeDelUsuario: 'sede-a' });
    await servicio(f.prisma).list(usuario('TENANT_STAFF'), undefined);
    expect(f.llamadas[0].where.locationId).toBeUndefined();
  });

  it('tampoco puede abrir por id un pedido de otra sede', async () => {
    // Ocultarlo de la lista no sirve de nada si se puede abrir escribiendo el
    // id en la barra del navegador.
    const f = prismaFalso({ sedeDelUsuario: 'sede-a', sedeDelPedido: 'sede-b' });
    await expect(
      servicio(f.prisma).get(usuario('TENANT_ORDERS'), 'o1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sí puede abrir uno de la suya', async () => {
    const f = prismaFalso({ sedeDelUsuario: 'sede-a', sedeDelPedido: 'sede-a' });
    const o = await servicio(f.prisma).get(usuario('TENANT_ORDERS'), 'o1');
    expect(o.id).toBe('o1');
  });
});
