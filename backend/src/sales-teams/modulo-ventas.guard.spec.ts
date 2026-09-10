import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

// `resolveBrandScope` toca la base para resolver la marca de la sesión. Aquí
// solo importa QUÉ marca devuelve, así que se sustituye.
vi.mock('../common/white-label/brand-scope.util', () => ({
  resolveBrandScope: async (_p: unknown, wlId: string | null) => ({
    wlId: wlId ?? 'clubify-id',
    isClubify: (wlId ?? 'clubify-id') === 'clubify-id',
  }),
}));

import { ModuloVentasGuard } from './modulo-ventas.guard';

/**
 * Esconder el menú NO es cerrar la puerta.
 *
 * El agujero que cierra este guard: `admin/sales-teams` no pasaba por
 * `resolveTeamAccess`, así que un admin de una marca SIN el módulo podía pedir
 * la lista y crear un equipo escribiendo la URL a mano. En el panel no se veía
 * la opción, y aun así funcionaba.
 */
function contexto(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function prismaCon(modulos: Record<string, boolean>) {
  return {
    whiteLabelModule: {
      findUnique: async ({ where }: any) => {
        const wl = where.whiteLabelId_module.whiteLabelId;
        return wl in modulos ? { enabled: modulos[wl] } : null;
      },
    },
  } as any;
}

const ADMIN_SELLEA = { id: 'u1', role: 'SUPER_ADMIN', whiteLabelId: 'sellea-id' };
const ADMIN_CLUBIFY = { id: 'u2', role: 'SUPER_ADMIN', whiteLabelId: 'clubify-id' };

describe('ModuloVentasGuard', () => {
  it('deja pasar a una marca CON el módulo encendido', async () => {
    const g = new ModuloVentasGuard(prismaCon({ 'clubify-id': true }));
    await expect(g.canActivate(contexto(ADMIN_CLUBIFY))).resolves.toBe(true);
  });

  it('EL CASO SELLEA: sin fila del módulo, 404', async () => {
    // Sellea no tiene fila `SALES_TEAMS` en absoluto — ni true ni false.
    const g = new ModuloVentasGuard(prismaCon({ 'clubify-id': true }));
    await expect(
      g.canActivate(contexto(ADMIN_SELLEA)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('con la fila en false tampoco pasa', async () => {
    const g = new ModuloVentasGuard(prismaCon({ 'sellea-id': false }));
    await expect(
      g.canActivate(contexto(ADMIN_SELLEA)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 y no 403: un 403 confirmaría que la función existe', async () => {
    const g = new ModuloVentasGuard(prismaCon({}));
    await g.canActivate(contexto(ADMIN_SELLEA)).then(
      () => expect.fail('debería haber lanzado'),
      (e) => {
        expect(e).toBeInstanceOf(NotFoundException);
        expect(e.getStatus()).toBe(404);
      },
    );
  });

  it('sin sesión no decide: de eso se ocupa el guard de auth, que corre antes', async () => {
    const g = new ModuloVentasGuard(prismaCon({}));
    await expect(g.canActivate(contexto(undefined))).resolves.toBe(true);
  });
});
