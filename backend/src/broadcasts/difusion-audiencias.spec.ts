import { describe, it, expect } from 'vitest';
import { BroadcastsService } from './broadcasts.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Difusión interna: quién ve qué, y cómo se turnan los popups.
 *
 * Dos cosas que no se pueden romper:
 *
 *  1. Los dos mundos NO se mezclan. `ALL` significa «todos los afiliados»
 *     desde que existe el módulo, y esas piezas hablan de comisiones y de
 *     argumentario de venta. Al montar el popup en el panel del negocio, el
 *     `default: return ['ALL']` del mapeo de roles se las habría enseñado a
 *     los 115 negocios. Por eso hay una prueba por rol.
 *
 *  2. Un negocio no se come tres modales bloqueantes seguidos. Con varios
 *     avisos vivos, el descanso los reparte en el tiempo.
 */

type Pieza = { id: string; createdAt: Date };

/** Prisma de mentira: apunta el `where` y devuelve lo que se le diga. */
function prismaFalso(opts: {
  piezas?: Pieza[];
  leidos?: string[];
  ultimaLectura?: Date | null;
  rotacion?: { horas: number; modo: string } | null;
}) {
  const llamadas: { where: any }[] = [];
  return {
    llamadas,
    prisma: {
      broadcast: {
        findMany: async (args: any) => {
          llamadas.push({ where: args.where });
          return opts.piezas ?? [];
        },
      },
      broadcastRead: {
        findMany: async () =>
          (opts.leidos ?? []).map((id) => ({ broadcastId: id })),
        findFirst: async () =>
          opts.ultimaLectura ? { readAt: opts.ultimaLectura } : null,
      },
      setting: {
        findUnique: async () =>
          opts.rotacion ? { value: JSON.stringify(opts.rotacion) } : null,
      },
    } as any,
  };
}

const usuario = (role: string, id = 'u1'): AuthUser =>
  ({ id, role, tenantId: 't1' }) as any;

function pieza(id: string, dia: number): Pieza {
  return { id, createdAt: new Date(2026, 0, dia) };
}

describe('difusión interna · a quién le llega', () => {
  it('al DUEÑO del negocio solo le llegan las piezas de negocios', async () => {
    const { prisma, llamadas } = prismaFalso({});
    const svc = new BroadcastsService(prisma);
    await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(llamadas[0].where.audience.in).toEqual(['TENANTS']);
  });

  it('al dueño NO le llega «todos los afiliados»', async () => {
    const { prisma, llamadas } = prismaFalso({});
    const svc = new BroadcastsService(prisma);
    await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(llamadas[0].where.audience.in).not.toContain('ALL');
  });

  it('a los EMPLEADOS del negocio no les llega nada, ni consulta se hace', async () => {
    for (const rol of ['TENANT_STAFF', 'TENANT_ORDERS']) {
      const { prisma, llamadas } = prismaFalso({ piezas: [pieza('b1', 1)] });
      const svc = new BroadcastsService(prisma);
      const r = await svc.getPendingLoginPopupForUser(usuario(rol));
      expect(r).toBeNull();
      expect(llamadas).toHaveLength(0);
    }
  });

  it('al afiliado le siguen llegando las suyas, como antes', async () => {
    const { prisma, llamadas } = prismaFalso({});
    const svc = new BroadcastsService(prisma);
    await svc.getPendingLoginPopupForUser(usuario('AFFILIATE_VENDOR'));
    expect(llamadas[0].where.audience.in).toEqual([
      'ALL',
      'VENDORS',
      'AMBASSADORS',
    ]);
  });

  it('al afiliado NO le llegan las piezas de negocios', async () => {
    const { prisma, llamadas } = prismaFalso({});
    const svc = new BroadcastsService(prisma);
    await svc.getPendingLoginPopupForUser(usuario('AFFILIATE_INFLUENCER'));
    expect(llamadas[0].where.audience.in).not.toContain('TENANTS');
  });

  it('el banner respeta la misma regla', async () => {
    const { prisma, llamadas } = prismaFalso({});
    const svc = new BroadcastsService(prisma);
    await svc.getActiveBannerForUser(usuario('TENANT_OWNER'));
    expect(llamadas[0].where.audience.in).toEqual(['TENANTS']);
  });
});

describe('difusión interna · cómo se turnan los popups', () => {
  const tres = [pieza('b1', 1), pieza('b2', 2), pieza('b3', 3)];

  it('sin nada leído, le toca el más antiguo', async () => {
    const { prisma } = prismaFalso({ piezas: tres });
    const svc = new BroadcastsService(prisma);
    const r = await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(r?.id).toBe('b1');
  });

  it('acaba de leer uno: ahora mismo no le toca otro', async () => {
    const { prisma } = prismaFalso({
      piezas: tres,
      leidos: ['b1'],
      ultimaLectura: new Date(Date.now() - 60 * 60 * 1000), // hace 1 hora
      rotacion: { horas: 6, modo: 'ORDEN' },
    });
    const svc = new BroadcastsService(prisma);
    expect(
      await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER')),
    ).toBeNull();
  });

  it('pasado el descanso, le toca el siguiente', async () => {
    const { prisma } = prismaFalso({
      piezas: tres,
      leidos: ['b1'],
      ultimaLectura: new Date(Date.now() - 7 * 60 * 60 * 1000), // hace 7 horas
      rotacion: { horas: 6, modo: 'ORDEN' },
    });
    const svc = new BroadcastsService(prisma);
    const r = await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(r?.id).toBe('b2');
  });

  it('con descanso en 0 se los muestra seguidos (como antes de la rotación)', async () => {
    const { prisma } = prismaFalso({
      piezas: tres,
      leidos: ['b1'],
      ultimaLectura: new Date(),
      rotacion: { horas: 0, modo: 'ORDEN' },
    });
    const svc = new BroadcastsService(prisma);
    const r = await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(r?.id).toBe('b2');
  });

  it('ALTERNAR reparte: no todos los negocios ven lo mismo', async () => {
    const vistos = new Set<string>();
    for (const id of ['neg-1', 'neg-2', 'neg-3', 'neg-4', 'neg-5', 'neg-6']) {
      const { prisma } = prismaFalso({
        piezas: tres,
        rotacion: { horas: 6, modo: 'ALTERNAR' },
      });
      const svc = new BroadcastsService(prisma);
      const r = await svc.getPendingLoginPopupForUser(
        usuario('TENANT_OWNER', id),
      );
      vistos.add(r!.id);
    }
    expect(vistos.size).toBeGreaterThan(1);
  });

  it('ALTERNAR no cambia al recargar: dentro de la misma franja, el mismo aviso', async () => {
    const pedir = async () => {
      const { prisma } = prismaFalso({
        piezas: tres,
        rotacion: { horas: 6, modo: 'ALTERNAR' },
      });
      const svc = new BroadcastsService(prisma);
      const r = await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
      return r!.id;
    };
    expect(await pedir()).toBe(await pedir());
  });

  it('sin nada pendiente devuelve null', async () => {
    const { prisma } = prismaFalso({
      piezas: tres,
      leidos: ['b1', 'b2', 'b3'],
    });
    const svc = new BroadcastsService(prisma);
    expect(
      await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER')),
    ).toBeNull();
  });

  it('un valor corrupto en la config no deja al panel sin avisos', async () => {
    const { prisma } = prismaFalso({ piezas: tres });
    (prisma as any).setting.findUnique = async () => ({ value: 'no soy json' });
    const svc = new BroadcastsService(prisma);
    const r = await svc.getPendingLoginPopupForUser(usuario('TENANT_OWNER'));
    expect(r?.id).toBe('b1');
  });
});
