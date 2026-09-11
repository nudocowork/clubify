import { describe, it, expect, vi } from 'vitest';

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

vi.mock('../common/white-label/brand-scope.util', () => ({
  resolveBrandScope: async (_p: unknown, wlId: string | null) => {
    const id = wlId ?? CLUBIFY;
    return { wlId: id, clubifyId: CLUBIFY, isClubify: id === CLUBIFY };
  },
}));

// El middleware de negocio se simula: `runWithoutTenant` marca que la consulta
// va SIN el filtro automático, que es justo lo que hay que probar.
let sinFiltro = false;
vi.mock('../common/tenant/tenant-context', () => ({
  TenantContext: {
    runWithoutTenant: <T>(fn: () => T): T => {
      sinFiltro = true;
      return fn();
    },
  },
}));

import { SalesTeamsService } from './sales-teams.service';

/**
 * Quién se puede meter en un equipo de ventas.
 *
 * EL FALLO: `User` tiene `tenantId`, así que el middleware le inyecta el
 * negocio a toda consulta. Y **un afiliado no pertenece a ningún negocio** —
 * su `tenantId` es null. Resultado: esto devolvía CERO en todas las marcas,
 * con 34 afiliados activos en la base. Se podía crear un equipo y no meter a
 * nadie, y el panel enseñaba el desplegable vacío sin decir por qué.
 *
 * El aislamiento entre marcas NO se pierde: se hace a mano con el código de
 * referido, que es donde vive de verdad la marca de un afiliado.
 */
function servicio() {
  sinFiltro = false;
  let whereVisto: any = null;
  const prisma: any = {
    user: {
      findMany: async ({ where }: any) => {
        whereVisto = where;
        return [{ id: 'u1', fullName: 'Ana', email: 'a@x.com', role: 'AFFILIATE_SOCIO' }];
      },
    },
    salesTeamMember: { findMany: async () => [{ userId: 'ya-esta' }] },
  };
  return {
    srv: new SalesTeamsService(prisma) as any,
    verWhere: () => whereVisto,
    fueSinFiltro: () => sinFiltro,
  };
}

describe('listEligibleUsers', () => {
  it('corre FUERA del filtro automático de negocio', async () => {
    // Sin esto no sale ni un afiliado: no pertenecen a ningún negocio.
    const c = servicio();
    await c.srv.listEligibleUsers({ whiteLabelId: SELLEA } as any);
    expect(c.fueSinFiltro()).toBe(true);
  });

  it('pero el aislamiento por marca SIGUE, por el código de referido', async () => {
    const c = servicio();
    await c.srv.listEligibleUsers({ whiteLabelId: SELLEA } as any);
    expect(c.verWhere().referralCodes).toEqual({
      some: { whiteLabelId: SELLEA },
    });
  });

  it('sin marca en la sesión cae a Clubify, NUNCA a «todos»', async () => {
    const c = servicio();
    await c.srv.listEligibleUsers({ whiteLabelId: null } as any);
    expect(c.verWhere().referralCodes).toEqual({
      some: { whiteLabelId: CLUBIFY },
    });
  });

  it('solo afiliados activos', async () => {
    const c = servicio();
    await c.srv.listEligibleUsers({ whiteLabelId: SELLEA } as any);
    const w = c.verWhere();
    expect(w.isActive).toBe(true);
    expect(w.role.in).toEqual([
      'AFFILIATE_INFLUENCER',
      'AFFILIATE_AMBASSADOR',
      'AFFILIATE_SOCIO',
    ]);
  });

  it('excluye a quien YA está en ese equipo', async () => {
    const c = servicio();
    await c.srv.listEligibleUsers({ whiteLabelId: SELLEA } as any, 't1');
    expect(c.verWhere().id).toEqual({ notIn: ['ya-esta'] });
  });
});
