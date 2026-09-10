import { describe, it, expect, vi } from 'vitest';

const CLUBIFY = 'clubify-id';
const SELLEA = 'sellea-id';

vi.mock('../common/white-label/brand-scope.util', () => ({
  resolveBrandScope: async (_p: unknown, sessionWlId: string | null) => {
    const wlId = sessionWlId ?? CLUBIFY;
    return { wlId, clubifyId: CLUBIFY, isClubify: wlId === CLUBIFY };
  },
}));

import { CrmService } from './crm.service';

/**
 * EL RANKING NO PUEDE MEZCLAR MARCAS.
 *
 * Humberto (Sellea) tiene que ver SU equipo y SU ranking, sin nada de Clubify.
 * Dos fallos que había aquí y que este spec deja cerrados:
 *
 *  1. La marca salía de `user?.whiteLabelId ?? null`. Con la sesión sin marca
 *     el `where` quedaba VACÍO → el ranking enseñaba todas las marcas juntas.
 *  2. Los equipos se filtraban por los códigos de referido del líder o de los
 *     miembros, no por `SalesTeam.whiteLabelId`, que es su columna. Un equipo
 *     sin líder ni miembros no era de nadie.
 */
function servicioEspia() {
  const capturado: { equiposWhere?: any; contactosWhere?: any } = {};
  const prisma: any = {
    crmContact: {
      groupBy: async ({ where }: any) => {
        capturado.contactosWhere = where;
        // Un owner para que NO salga por el return temprano y se llegue a la
        // consulta de equipos, que es la que se quiere inspeccionar.
        return [{ ownerUserId: 'u1', _count: { _all: 3 } }];
      },
      findMany: async () => [],
    },
    user: {
      findMany: async () => [
        { id: 'u1', fullName: 'Uno', email: 'u@x.com', role: 'AFFILIATE_SOCIO' },
      ],
    },
    salesTeam: {
      findMany: async ({ where }: any) => {
        capturado.equiposWhere = where;
        return [];
      },
    },
  };
  return { srv: new CrmService(prisma) as any, capturado };
}

describe('getLeaderboard · aislamiento por marca', () => {
  it('Sellea filtra ESTRICTO por su whiteLabelId, sin los legacy', async () => {
    const { srv, capturado } = servicioEspia();
    await srv.getLeaderboard({ id: 'a', role: 'SUPER_ADMIN', whiteLabelId: SELLEA });

    expect(capturado.equiposWhere).toEqual({ whiteLabelId: SELLEA });
    // Nada de OR con null: los equipos viejos sin marca son de Clubify.
    expect(JSON.stringify(capturado.equiposWhere)).not.toContain('null');
    // Y los contactos, por los códigos de referido de SU marca.
    expect(JSON.stringify(capturado.contactosWhere)).toContain(SELLEA);
    expect(JSON.stringify(capturado.contactosWhere)).not.toContain(CLUBIFY);
  });

  it('Clubify incluye los equipos legacy sin marca', async () => {
    const { srv, capturado } = servicioEspia();
    await srv.getLeaderboard({ id: 'a', role: 'SUPER_ADMIN', whiteLabelId: CLUBIFY });

    expect(capturado.equiposWhere).toEqual({
      OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }],
    });
  });

  it('SIN marca en la sesión cae a Clubify, NUNCA a «ver todo»', async () => {
    const { srv, capturado } = servicioEspia();
    await srv.getLeaderboard({ id: 'a', role: 'PLATFORM_OWNER', whiteLabelId: null });

    // El fallo viejo dejaba `{}` aquí, que en Prisma es «tráelo todo».
    expect(capturado.equiposWhere).not.toEqual({});
    expect(capturado.equiposWhere).toEqual({
      OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }],
    });
  });

  it('el filtro de equipos usa la COLUMNA, no los códigos de referido', async () => {
    const { srv, capturado } = servicioEspia();
    await srv.getLeaderboard({ id: 'a', role: 'SUPER_ADMIN', whiteLabelId: SELLEA });

    const json = JSON.stringify(capturado.equiposWhere);
    expect(json).not.toContain('referralCodes');
    expect(json).not.toContain('leadUser');
    expect(json).not.toContain('members');
  });
});
