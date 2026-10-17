import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ReporteComisionesController } from './reporte-comisiones.controller';
import { SoloPlataformaGuard } from '../common/guards/solo-plataforma.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { olvidarMarcaClubify } from '../finance/alcance-de-marca';
import { Reflector } from '@nestjs/core';

/**
 * El reporte cruza el dinero de todos los colaboradores de la plataforma. Estas
 * pruebas se ponen en rojo si alguien quita el candado de la clase.
 */

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

function contexto(user: unknown, handler: unknown = ReporteComisionesController.prototype.resumen) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => ReporteComisionesController,
  } as any;
}

function guard() {
  const prisma: any = {
    whiteLabel: {
      findFirst: async ({ where }: any) => (where?.slug === 'clubify' ? { id: CLUBIFY } : null),
      findUnique: async ({ where }: any) =>
        where?.id === CLUBIFY ? { id: CLUBIFY, slug: 'clubify' } : where?.id === SELLEA ? { id: SELLEA, slug: 'sellea' } : null,
    },
  };
  return new SoloPlataformaGuard(prisma);
}

beforeEach(() => olvidarMarcaClubify());

describe('el reporte de comisiones es solo de la plataforma', () => {
  it('la clase entera lleva SoloPlataformaGuard', () => {
    const guards = (Reflect.getMetadata('__guards__', ReporteComisionesController) ?? []) as unknown[];
    expect(guards).toContain(SoloPlataformaGuard);
  });

  it('y solo el rol SUPER_ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReporteComisionesController)).toEqual(['SUPER_ADMIN']);
  });

  it('ningún método abre la puerta con @Public o con otros roles', () => {
    const metodos = Object.getOwnPropertyNames(ReporteComisionesController.prototype).filter((m) => m !== 'constructor');
    expect(metodos.length).toBeGreaterThan(10);
    for (const m of metodos) {
      const h = (ReporteComisionesController.prototype as any)[m];
      expect(Reflect.getMetadata('isPublic', h)).toBeFalsy();
      expect(Reflect.getMetadata(ROLES_KEY, h)).toBeUndefined();
    }
  });

  it('el admin de una marca blanca recibe 403 aunque sea SUPER_ADMIN', async () => {
    await expect(guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: SELLEA }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('la plataforma (sin marca o dentro de Clubify) entra', async () => {
    expect(await guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: null }))).toBe(true);
    expect(await guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: CLUBIFY }))).toBe(true);
  });

  it.each(['MARKETING', 'AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_VENDOR', 'TENANT_OWNER'])(
    '%s no pasa el control de rol',
    (role) => {
      const roles = new RolesGuard(new Reflector());
      expect(() => roles.canActivate(contexto({ role }))).toThrow(ForbiddenException);
    },
  );
});
