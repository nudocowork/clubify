import { describe, it, expect } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  exigirEscritura,
  moduloEncendido,
  normalizarRoles,
  resolveTeamAccess,
} from './team-access';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Quién entra a un equipo de ventas.
 *
 * En este producto el aislamiento entre marcas se escribe a mano en cada
 * consulta y no hay red debajo. Estas pruebas son esa red para el módulo
 * nuevo, y fijan tres decisiones que de otro modo alguien «arreglaría»:
 *
 *  1. Un equipo de otra marca responde **404**, no 403: un 403 confirmaría
 *     que ese id existe.
 *  2. Con el módulo apagado, el equipo responde como si no existiera. Los
 *     módulos de esta plataforma hoy solo esconden la interfaz — y esconder
 *     un menú no protege una API.
 *  3. Un rol inventado no da permisos.
 */

const CLUBIFY = 'wl-clubify';
const SELLEA = 'wl-sellea';

/** Prisma de mentira: solo lo que toca `resolveTeamAccess`. */
function prismaFalso(opts: {
  team?: { id: string; name: string; whiteLabelId: string | null; isActive: boolean } | null;
  moduloEncendido?: boolean;
  miembro?: { roles: string[]; isActive: boolean } | null;
}) {
  return {
    whiteLabel: {
      findFirst: async () => ({ id: CLUBIFY }),
    },
    salesTeam: {
      findUnique: async () => opts.team ?? null,
    },
    whiteLabelModule: {
      findUnique: async () =>
        opts.moduloEncendido === false ? { enabled: false } : opts.moduloEncendido === undefined ? null : { enabled: true },
    },
    salesTeamMember: {
      findUnique: async () => opts.miembro ?? null,
    },
  } as any;
}

const equipo = (whiteLabelId: string | null) => ({
  id: 't1',
  name: 'Equipo Norte',
  whiteLabelId,
  isActive: true,
});

const usuario = (role: string, whiteLabelId: string | null, id = 'u1'): AuthUser =>
  ({ id, role, whiteLabelId }) as any;

describe('acceso al equipo · la marca', () => {
  it('el admin de su marca entra y puede escribir', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: true,
    });
    const a = await resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1');
    expect(a.esAdminDeMarca).toBe(true);
    expect(a.puedeEscribir).toBe(true);
  });

  it('el admin de OTRA marca recibe 404, no 403', async () => {
    const prisma = prismaFalso({
      team: equipo(CLUBIFY),
      moduloEncendido: true,
    });
    await expect(
      resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un equipo que no existe responde igual que uno ajeno', async () => {
    const prisma = prismaFalso({ team: null, moduloEncendido: true });
    await expect(
      resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('acceso al equipo · el interruptor', () => {
  it('con el módulo APAGADO el equipo no existe, aunque seas su admin', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: false,
    });
    await expect(
      resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin fila de módulo tampoco: lo que no se encendió, está apagado', async () => {
    const prisma = prismaFalso({ team: equipo(SELLEA) });
    await expect(
      resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un equipo SIN marca no puede entrar por la puerta de atrás', async () => {
    // Sin marca no hay módulo que encender. Dejarlo pasar sería el agujero.
    const prisma = prismaFalso({ team: equipo(null), moduloEncendido: true });
    await expect(
      resolveTeamAccess(prisma, usuario('SUPER_ADMIN', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('moduloEncendido dice que no cuando no hay marca', async () => {
    expect(await moduloEncendido(prismaFalso({}), null)).toBe(false);
  });
});

describe('acceso al equipo · los miembros', () => {
  it('quien no es miembro y no es admin recibe 403', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: true,
      miembro: null,
    });
    await expect(
      resolveTeamAccess(prisma, usuario('AFFILIATE_VENDOR', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un miembro desactivado ya no entra', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: true,
      miembro: { roles: ['closer'], isActive: false },
    });
    await expect(
      resolveTeamAccess(prisma, usuario('AFFILIATE_VENDOR', SELLEA), 't1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el de «lectura» entra pero no escribe', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: true,
      miembro: { roles: ['lectura'], isActive: true },
    });
    const a = await resolveTeamAccess(prisma, usuario('AFFILIATE_VENDOR', SELLEA), 't1');
    expect(a.puedeEscribir).toBe(false);
    expect(() => exigirEscritura(a)).toThrow(ForbiddenException);
  });

  it('setter y closer a la vez sí escribe', async () => {
    const prisma = prismaFalso({
      team: equipo(SELLEA),
      moduloEncendido: true,
      miembro: { roles: ['setter', 'closer'], isActive: true },
    });
    const a = await resolveTeamAccess(prisma, usuario('AFFILIATE_VENDOR', SELLEA), 't1');
    expect(a.roles).toEqual(['setter', 'closer']);
    expect(a.puedeEscribir).toBe(true);
  });
});

describe('los roles', () => {
  it('un rol inventado no da permisos', () => {
    expect(normalizarRoles(['administrador', 'root', 'lider'])).toEqual(['lider']);
  });

  it('no distingue mayúsculas ni espacios', () => {
    expect(normalizarRoles([' LIDER ', 'Closer'])).toEqual(['lider', 'closer']);
  });

  it('no repite', () => {
    expect(normalizarRoles(['setter', 'setter'])).toEqual(['setter']);
  });

  it('lo que no es una lista se queda en nada', () => {
    expect(normalizarRoles(null)).toEqual([]);
    expect(normalizarRoles('lider')).toEqual([]);
  });
});
