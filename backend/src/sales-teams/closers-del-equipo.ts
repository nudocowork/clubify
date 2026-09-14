import { PrismaService } from '../common/prisma/prisma.service';
import { normalizarRoles } from './team-access';

/**
 * Los closers ACTIVOS de un equipo, ordenados por nombre.
 *
 * Una sola copia de esta regla para el Banco (a quién se le puede asignar una
 * cita) y la Agenda (las columnas de la rejilla). Si las dos pantallas la
 * calcularan cada una a su manera, un closer podría salir en la rejilla y no
 * aparecer para asignarle citas, o al revés.
 *
 * `SalesTeamMember` no tiene `tenantId`, así que el middleware de negocio no lo
 * filtra, y el `select` anidado de `user` tampoco pasa por él: en el panel de
 * una marca la lista no sale vacía (comprobado en la revisión del Banco).
 */
export async function closersActivosDelEquipo(
  prisma: PrismaService,
  teamId: string,
): Promise<Array<{ id: string; nombre: string }>> {
  const miembros = await prisma.salesTeamMember.findMany({
    where: { teamId, isActive: true },
    select: { userId: true, roles: true, user: { select: { fullName: true } } },
  });
  return miembros
    .filter((m) => normalizarRoles(m.roles).includes('closer'))
    .map((m) => ({ id: m.userId, nombre: m.user?.fullName ?? 'Sin nombre' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
