import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveTeamAccess } from './team-access';

/**
 * Las listas de un equipo: Banco, Contactos, Clientes y Seguimientos.
 *
 * El tablero ya devuelve los leads, pero AGRUPADOS POR COLUMNA y recortados
 * —avisa con `truncado`—, que es lo que necesita un kanban y justo lo que no
 * sirve para «enséñame los que no tienen vendedor» o «los que ya compraron».
 * Por eso una lista propia, plana, filtrable y buscable.
 *
 * Las cuatro pestañas son la MISMA consulta con otro filtro. Tenerlas como
 * cuatro endpoints distintos sería cuatro sitios donde el aislamiento por
 * marca puede olvidarse; así solo hay uno, y empieza por `resolveTeamAccess`
 * como todo este módulo.
 */

/** Qué subconjunto de leads pide la pestaña. */
export type FiltroDeLista = 'banco' | 'contactos' | 'clientes';

const TOPE = 300;

@Injectable()
export class ListasDeEquipoService {
  constructor(private prisma: PrismaService) {}

  async leads(
    user: AuthUser,
    teamId: string,
    opts: { filtro?: FiltroDeLista; buscar?: string; limit?: number } = {},
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const filtro: FiltroDeLista = opts.filtro ?? 'contactos';
    const buscar = (opts.buscar ?? '').trim();

    const porFiltro =
      filtro === 'banco'
        ? { assignedUserId: null }
        : filtro === 'clientes'
          ? { wonAt: { not: null } }
          : {};

    // Se busca por lo que la gente tiene a mano cuando pregunta por alguien:
    // su nombre, su teléfono, su correo o la empresa. `mode: 'insensitive'`
    // porque nadie escribe los nombres como están guardados.
    const porTexto = buscar
      ? {
          OR: [
            { name: { contains: buscar, mode: 'insensitive' as const } },
            { phone: { contains: buscar } },
            { email: { contains: buscar, mode: 'insensitive' as const } },
            { company: { contains: buscar, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const where = { salesTeamId: teamId, ...porFiltro, ...porTexto };
    const take = Math.min(opts.limit ?? TOPE, TOPE);

    const [filas, total, mensajes] = await Promise.all([
      this.prisma.salesLead.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        take,
        select: {
          id: true, name: true, phone: true, email: true, company: true,
          source: true, value: true, wonAt: true, lostReason: true,
          lastActivityAt: true, createdAt: true, mktContactId: true,
          assignedUser: { select: { id: true, fullName: true } },
          stage: { select: { id: true, name: true, color: true } },
        },
      }),
      this.prisma.salesLead.count({ where }),
      // Cuántos mensajes tiene cada lead, para saber cuáles tienen
      // conversación abierta sin pedir el hilo de todos.
      this.prisma.salesMessage.groupBy({
        by: ['leadId'],
        where: { salesTeamId: teamId },
        _count: { _all: true },
      }),
    ]);

    const conversacion = new Map(mensajes.map((m) => [m.leadId, m._count._all]));

    return {
      filtro,
      total,
      truncado: total > filas.length,
      puedeEscribir: acceso.puedeEscribir,
      leads: filas.map((l) => ({
        ...l,
        value: l.value == null ? null : Number(l.value),
        mensajes: conversacion.get(l.id) ?? 0,
      })),
    };
  }

  /**
   * Los seguimientos del equipo.
   *
   * Por defecto los PENDIENTES y en orden de vencimiento: lo primero de la
   * lista es lo que ya se pasó de fecha. Un listado de seguimientos ordenado
   * por creación no sirve para trabajar.
   */
  async seguimientos(
    user: AuthUser,
    teamId: string,
    opts: { estado?: 'pendientes' | 'hechos' | 'todos' } = {},
  ) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const estado = opts.estado ?? 'pendientes';
    const where = {
      salesTeamId: teamId,
      ...(estado === 'todos' ? {} : { done: estado === 'hechos' }),
    };

    const filas = await this.prisma.salesFollowup.findMany({
      where,
      orderBy: estado === 'hechos' ? { doneAt: 'desc' } : { dueAt: 'asc' },
      take: TOPE,
      select: {
        id: true, dueAt: true, channel: true, note: true,
        done: true, doneAt: true, outcome: true, assignedUserId: true,
        lead: { select: { id: true, name: true, phone: true } },
      },
    });

    // El nombre de quien lo tiene asignado. `SalesFollowup.assignedUserId` no
    // declara relación, así que se resuelve aparte en UNA consulta.
    const ids = [...new Set(filas.map((f) => f.assignedUserId).filter(Boolean))] as string[];
    const personas = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true },
        })
      : [];
    const nombre = new Map(personas.map((p) => [p.id, p.fullName]));

    const ahora = new Date();
    return {
      estado,
      total: filas.length,
      seguimientos: filas.map((f) => ({
        ...f,
        asignadoA: f.assignedUserId ? (nombre.get(f.assignedUserId) ?? null) : null,
        vencido: !f.done && f.dueAt < ahora,
      })),
    };
  }
}
