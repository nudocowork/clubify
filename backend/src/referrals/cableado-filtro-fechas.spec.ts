import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';
import { rangoBogota, whereSupersetDeFecha } from './rango-de-fechas';

/**
 * EL CABLEADO del filtro de fechas, no sólo sus piezas.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO: `rango-de-fechas.spec.ts` comprueba que el
 * módulo devuelve el `where` correcto, pero no que `listAdminCommissions` lo
 * USE. Por ahí entró el bug original: la función construía el filtro a mano
 * (`baseWhere[field] = range`) mirando sólo la columna `businessDate`. Si
 * alguien vuelve a escribir esa línea, los tests del módulo siguen todos en
 * verde y el bug regresa entero — Serendipity y otros 9 vuelven a
 * desaparecer del panel.
 *
 * Así que aquí se llama al servicio de verdad con un Prisma de mentira y se
 * mira QUÉ `where` acaba pidiéndole a la base.
 */

/** Prisma mínimo para que `listAdminCommissions` llegue hasta el final. */
function prismaFalso() {
  const consultas: any[] = [];
  const prisma: any = {
    commission: {
      findMany: vi.fn(async (args: any) => {
        consultas.push(args);
        return [];
      }),
      aggregate: vi.fn(async () => ({
        _count: { _all: 0 },
        _sum: { amount: null, amountPaid: null },
      })),
      groupBy: vi.fn(async () => []),
    },
  };
  return { prisma, consultas };
}

function servicio(prisma: any) {
  // Sólo se usa `prisma` en este camino; el resto de dependencias no se tocan.
  return new ReferralsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const SUPER_ADMIN = { role: 'SUPER_ADMIN' } as any;

describe('listAdminCommissions arma el filtro A TRAVÉS del módulo', () => {
  it('la consulta de recorte lleva el superconjunto que genera el módulo', async () => {
    const { prisma, consultas } = prismaFalso();
    await servicio(prisma).listAdminCommissions(SUPER_ADMIN, {
      dateFrom: '2026-08-16',
      dateTo: '2026-08-31',
      todasLasMarcas: true,
    });

    const rango = rangoBogota('2026-08-16', '2026-08-31')!;
    expect(consultas.length).toBeGreaterThanOrEqual(2);
    // La 1ª consulta es el recorte exacto: `{ AND: [baseWhere, superconjunto] }`.
    expect(
      consultas[0].where?.AND?.[1],
      'el where no sale de whereSupersetDeFecha: alguien volvió a filtrar a mano',
    ).toEqual(whereSupersetDeFecha('purchase', rango));
  });

  it('la tabla se pide por ids ya recortados, NO por la columna en crudo', async () => {
    const { prisma, consultas } = prismaFalso();
    await servicio(prisma).listAdminCommissions(SUPER_ADMIN, {
      dateFrom: '2026-08-16',
      dateTo: '2026-08-31',
      todasLasMarcas: true,
    });

    const whereTabla = consultas[1].where;
    // Sin candidatos, el recorte devuelve [] y así queda la consulta.
    expect(whereTabla.id).toEqual({ in: [] });
    // Y esto es EL bug: un rango crudo sobre la columna se come las filas cuyo
    // `businessDate` es NULL aunque el panel les pinte fecha.
    expect(
      whereTabla.businessDate,
      'volvió el filtro crudo sobre la columna businessDate',
    ).toBeUndefined();
  });

  it('el recorte también se cablea para la fecha de desbloqueo', async () => {
    const { prisma, consultas } = prismaFalso();
    await servicio(prisma).listAdminCommissions(SUPER_ADMIN, {
      dateFrom: '2026-08-16',
      dateTo: '2026-08-31',
      dateType: 'available',
      todasLasMarcas: true,
    });

    const rango = rangoBogota('2026-08-16', '2026-08-31')!;
    expect(consultas[0].where?.AND?.[1]).toEqual(
      whereSupersetDeFecha('available', rango),
    );
    expect(consultas[1].where.availableAt).toBeUndefined();
  });

  it('sin rango de fechas no se recorta nada (no hay consulta de más)', async () => {
    const { prisma, consultas } = prismaFalso();
    await servicio(prisma).listAdminCommissions(SUPER_ADMIN, {
      todasLasMarcas: true,
    });
    // Sólo la consulta de la tabla: el recorte no se dispara sin rango.
    expect(consultas[0].where.id).toBeUndefined();
  });
});
