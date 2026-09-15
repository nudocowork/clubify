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

/**
 * El nombre de quien usa la pantalla, para firmar el WhatsApp («Te habla
 * {{closer}}»). En la referencia es la persona en sesión, no el closer de la
 * cita: en «Por asignar» no hay closer y el mensaje salía «Te habla, del equipo…»,
 * y un setter que escribe no debe firmar como otro (Fable, 2026-09-15).
 *
 * Primero por la membresía (`User` pasa por el filtro de negocio y un afiliado
 * sin negocio saldría sin nombre); un admin que no es miembro, por su usuario.
 */
export async function nombreDeQuienUsa(
  prisma: PrismaService,
  teamId: string,
  userId: string,
): Promise<string | null> {
  const miembro = await prisma.salesTeamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { user: { select: { fullName: true } } },
  });
  if (miembro?.user?.fullName) return miembro.user.fullName;
  const usuario = await prisma.user
    .findUnique({ where: { id: userId }, select: { fullName: true } })
    .catch(() => null);
  return usuario?.fullName ?? null;
}
