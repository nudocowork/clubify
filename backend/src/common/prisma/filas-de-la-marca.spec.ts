import { describe, it, expect } from 'vitest';
import { tenantMiddleware } from './prisma-tenant-middleware';
import { TenantContext } from '../tenant/tenant-context';

/**
 * Sara (2026-10-03): «en Comisiones aparece, pero no en Contabilidad». El admin
 * de Clubify trabaja DENTRO de la marca, y el middleware acotaba el libro de
 * ingresos a `tenantId IN (negocios de la marca)`: los cobros sin negocio —un
 * grupo empresarial, que paga una vez aunque ocupe tres negocios; los packs—
 * desaparecían de su Contabilidad y de sus totales.
 */

const CLUBIFY = 'wl-clubify';
const NEGOCIOS = ['t1', 't2'];

async function whereDe(model: string, where?: Record<string, unknown>) {
  let visto: any = null;
  await TenantContext.run(
    {
      tenantId: null,
      userId: 'sara',
      role: 'SUPER_ADMIN' as never,
      bypass: false,
      whiteLabelId: CLUBIFY,
      whiteLabelTenantIds: NEGOCIOS,
    },
    () =>
      tenantMiddleware()(
        { model, action: 'findMany', args: where ? { where } : {}, dataPath: [], runInTransaction: false } as never,
        async (p: any) => {
          visto = p.args.where;
          return [];
        },
      ),
  );
  return visto;
}

describe('dentro de una marca, los cobros sin negocio de ESA marca se ven', () => {
  it('el libro de ingresos: sus negocios ∪ lo de la marca sin negocio (grupos, packs)', async () => {
    const w = await whereDe('IncomeRecord', { status: 'PAGADO' });
    expect(w).toEqual({
      AND: [
        { status: 'PAGADO' },
        { OR: [{ tenantId: { in: NEGOCIOS } }, { whiteLabelId: CLUBIFY, tenantId: null }] },
      ],
    });
  });

  it('lo sin negocio de OTRA marca no entra: el filtro exige la marca activa', async () => {
    const w = await whereDe('IncomeRecord');
    const sinNegocio = w.OR.find((x: any) => x.tenantId === null);
    expect(sinNegocio.whiteLabelId).toBe(CLUBIFY);
  });

  it('las demás tablas con tenantId siguen solo por negocio', async () => {
    const w = await whereDe('ManualPayment');
    expect(w).toEqual({ tenantId: { in: NEGOCIOS } });
  });
});

describe('crear un cobro de la propia marca sin negocio (Sara, 2026-10-06)', () => {
  async function crear(data: Record<string, unknown>) {
    let llego: any = null;
    await TenantContext.run(
      { tenantId: null, userId: 'sara', role: 'SUPER_ADMIN' as never, bypass: false, whiteLabelId: CLUBIFY, whiteLabelTenantIds: NEGOCIOS },
      () =>
        tenantMiddleware()(
          { model: 'IncomeRecord', action: 'create', args: { data }, dataPath: [], runInTransaction: false } as never,
          async (p: any) => {
            llego = p.args.data;
            return {};
          },
        ),
    );
    return llego;
  }

  it('«Registrar pago» de una marca blanca: cobro de Clubify sin negocio, se permite', async () => {
    const d = await crear({ tenantId: null, whiteLabelId: CLUBIFY, payerWhiteLabelId: 'sellea', grossUsd: 1000 });
    expect(d).toMatchObject({ whiteLabelId: CLUBIFY });
  });

  it('un cobro sin negocio de OTRA marca sigue bloqueado', async () => {
    await expect(crear({ tenantId: null, whiteLabelId: 'otra-marca', grossUsd: 10 })).rejects.toThrow(/bloqueada/);
  });
});
