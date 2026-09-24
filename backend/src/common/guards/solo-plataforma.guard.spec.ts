import { describe, it, expect, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SoloPlataformaGuard } from './solo-plataforma.guard';
import { olvidarMarcaClubify } from '../../finance/alcance-de-marca';

/**
 * Un admin de marca blanca es SUPER_ADMIN con `whiteLabelId`: el RolesGuard lo
 * dejaba pasar a Contabilidad de Clubify por la API, y desde el 2026-09-17 ahí
 * se borran colaboradores y pagos de nómina (revisión de Fable).
 */

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

function contexto(user: unknown) {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as any;
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

describe('Lo de la plataforma no lo toca una marca blanca', () => {
  it('sesión sin marca (operador de la plataforma) entra', async () => {
    expect(await guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: null }))).toBe(true);
  });

  it('sesión dentro de Clubify entra', async () => {
    expect(await guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: CLUBIFY }))).toBe(true);
  });

  it('el admin de Sellea NO entra, aunque sea SUPER_ADMIN', async () => {
    await expect(guard().canActivate(contexto({ role: 'SUPER_ADMIN', whiteLabelId: SELLEA }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
