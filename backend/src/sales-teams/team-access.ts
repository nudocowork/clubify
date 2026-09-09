import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';

/**
 * Quién puede entrar a un equipo de ventas, y con qué permisos.
 *
 * TODO servicio del módulo empieza por aquí. Es el patrón de «guard delegado»
 * que ya usa el resto del backend: el aislamiento entre marcas en este
 * producto se escribe a mano en cada consulta y no hay red debajo, así que
 * concentrarlo en una función es lo único que evita que se olvide en la
 * décima ruta.
 *
 * Dos reglas que no son obvias y conviene no tocar sin leer esto:
 *
 * 1. **404 y no 403** cuando el equipo es de otra marca. Un 403 confirma que
 *    ese id existe; el 404 no dice nada. Es lo que ya hace la cita pública.
 *
 * 2. **El módulo se comprueba AQUÍ, en el backend.** Hoy los módulos de marca
 *    solo esconden la interfaz —lo comprobamos: ninguno se valida del lado del
 *    servidor—, y esconder un menú no protege una API. Con el módulo apagado
 *    esto responde como si el equipo no existiera.
 */

export type RolDeEquipo = 'lider' | 'closer' | 'setter' | 'lectura';

export type AccesoAlEquipo = {
  team: {
    id: string;
    name: string;
    whiteLabelId: string | null;
    isActive: boolean;
  };
  /** Manda sobre toda la marca: puede crear equipos y entrar a cualquiera. */
  esAdminDeMarca: boolean;
  /** Roles de esta persona EN ESTE equipo. Vacío si es admin y no es miembro. */
  roles: RolDeEquipo[];
  /** Puede escribir. `lectura` a secas no. */
  puedeEscribir: boolean;
};

const ADMIN_ROLES = new Set(['PLATFORM_OWNER', 'SUPER_ADMIN']);

/**
 * ¿La marca tiene encendido el módulo?
 *
 * Sin marca no hay módulo que encender, así que se rechaza: un equipo huérfano
 * no es de nadie y dejarlo pasar sería la puerta de atrás.
 */
export async function moduloEncendido(
  prisma: PrismaService,
  whiteLabelId: string | null,
): Promise<boolean> {
  if (!whiteLabelId) return false;
  const fila = await prisma.whiteLabelModule.findUnique({
    where: {
      whiteLabelId_module: { whiteLabelId, module: 'SALES_TEAMS' },
    },
    select: { enabled: true },
  });
  return !!fila?.enabled;
}

/** Las marcas que esta persona puede mirar. Nunca «todas» por descuido. */
export async function marcaDelUsuario(
  prisma: PrismaService,
  user: AuthUser,
): Promise<string | null> {
  const { wlId } = await resolveBrandScope(prisma, user.whiteLabelId);
  return wlId;
}

export async function resolveTeamAccess(
  prisma: PrismaService,
  user: AuthUser,
  teamId: string,
): Promise<AccesoAlEquipo> {
  const team = await prisma.salesTeam.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, whiteLabelId: true, isActive: true },
  });
  // El equipo no existe, o es de otra marca: la misma respuesta para los dos.
  if (!team) throw new NotFoundException('Equipo no encontrado');

  if (!(await moduloEncendido(prisma, team.whiteLabelId))) {
    throw new NotFoundException('Equipo no encontrado');
  }

  const esAdmin = ADMIN_ROLES.has(String(user.role));
  const miMarca = await marcaDelUsuario(prisma, user);

  if (esAdmin) {
    // Un admin manda en SU marca, no en las demás.
    if (team.whiteLabelId !== miMarca) {
      throw new NotFoundException('Equipo no encontrado');
    }
    const propio = await prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
      select: { roles: true, isActive: true },
    });
    return {
      team,
      esAdminDeMarca: true,
      roles: normalizarRoles(propio?.isActive ? propio.roles : []),
      puedeEscribir: true,
    };
  }

  const miembro = await prisma.salesTeamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
    select: { roles: true, isActive: true },
  });
  if (!miembro || !miembro.isActive) {
    throw new ForbiddenException('No perteneces a este equipo');
  }

  const roles = normalizarRoles(miembro.roles);
  return {
    team,
    esAdminDeMarca: false,
    roles,
    // «lectura» a secas mira y no toca. Con cualquier otro rol, escribe.
    puedeEscribir: roles.some((r) => r !== 'lectura'),
  };
}

/** Lanza si la persona no puede escribir. Para los POST/PATCH/DELETE. */
export function exigirEscritura(acceso: AccesoAlEquipo): void {
  if (!acceso.puedeEscribir) {
    throw new ForbiddenException('Tu rol en este equipo es de solo lectura');
  }
}

const ROLES_VALIDOS: RolDeEquipo[] = ['lider', 'closer', 'setter', 'lectura'];

/** Descarta lo que no es un rol conocido. Un rol inventado no da permisos. */
export function normalizarRoles(roles: unknown): RolDeEquipo[] {
  if (!Array.isArray(roles)) return [];
  const limpios = roles
    .map((r) => String(r).trim().toLowerCase())
    .filter((r): r is RolDeEquipo =>
      (ROLES_VALIDOS as string[]).includes(r),
    );
  return [...new Set(limpios)];
}
