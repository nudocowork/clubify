import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { exigirEscritura, resolveTeamAccess } from './team-access';

/**
 * «Clientes» del equipo: la implementación de cada venta cerrada.
 *
 * Antes la pestaña era la lista de leads con `wonAt` — la misma lista que
 * Contactos con otro filtro. Después de vender, lo que hay que saber es por
 * dónde va la puesta en marcha y qué falta, y eso lo dice una lista de
 * comprobación, no una lista de leads. Es lo que tiene TeamClubify.
 *
 * Todo método empieza por `resolveTeamAccess`, como el resto del módulo: el
 * aislamiento entre marcas se escribe a mano en cada consulta y no hay red
 * debajo.
 */

/**
 * Los 6 pasos con los que nace cada implementación. Los mismos de TeamClubify,
 * para que un equipo que trabaja en los dos sitios no aprenda dos procesos.
 */
export const PASOS_POR_DEFECTO = [
  'Crear accesos y cuenta del cliente',
  'Reunión de bienvenida / kickoff',
  'Configuración inicial de la plataforma',
  'Cargar datos / catálogo del cliente',
  'Capacitación al cliente',
  'Entrega y cierre de implementación',
] as const;

export const ESTADOS_DE_IMPLEMENTACION = [
  'pendiente',
  'en_progreso',
  'completada',
  'cancelada',
] as const;
export type EstadoDeImplementacion = (typeof ESTADOS_DE_IMPLEMENTACION)[number];

/** Días que se dan de plazo por defecto. Los de TeamClubify. */
const PLAZO_DIAS = 7;

/**
 * El estado que le toca a una implementación según sus pasos, o `null` si no
 * hay que cambiarlo.
 *
 * Puro a propósito, para probarlo sin base. Dos reglas, las de TeamClubify:
 * - todos hechos → `completada`;
 * - alguno sin hacer y estaba `pendiente` → `en_progreso` (se empezó).
 *
 * Lo que NO hace, y es deliberado: no saca de `cancelada` a nadie por marcar un
 * paso, y no devuelve a `en_progreso` una `completada` si se desmarca uno — eso
 * lo decide una persona con el selector de estado, no un clic en una casilla.
 */
export function estadoTrasMarcar(
  actual: string,
  pasos: Array<{ done: boolean }>,
): EstadoDeImplementacion | null {
  if (actual === 'cancelada') return null;
  const todos = pasos.length > 0 && pasos.every((x) => x.done);
  if (todos) return actual === 'completada' ? null : 'completada';
  if (actual === 'pendiente' && pasos.some((x) => x.done)) return 'en_progreso';
  return null;
}

@Injectable()
export class ImplementacionesDeEquipoService {
  constructor(private prisma: PrismaService) {}

  /** La pestaña: implementaciones del equipo, con sus pasos y los contadores. */
  async listar(user: AuthUser, teamId: string, opts: { estado?: string } = {}) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const estado = (ESTADOS_DE_IMPLEMENTACION as readonly string[]).includes(opts.estado ?? '')
      ? opts.estado
      : undefined;

    const [filas, porEstado] = await Promise.all([
      this.prisma.salesImplementation.findMany({
        where: { salesTeamId: teamId, ...(estado ? { status: estado } : {}) },
        // `desc` da justo el orden útil: pendiente → en_progreso → completada →
        // cancelada. Con `asc` (el de TeamClubify) lo activo quedaba al final.
        orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        include: { items: { orderBy: { position: 'asc' } } },
      }),
      // Los contadores son del equipo ENTERO, no del filtro: si no, al filtrar
      // «Completadas» el KPI de «Activas» diría 0 y parecería que no hay nada.
      this.prisma.salesImplementation.groupBy({
        by: ['status'],
        where: { salesTeamId: teamId },
        _count: { _all: true },
      }),
    ]);

    const cuenta = (s: string) => porEstado.find((x) => x.status === s)?._count._all ?? 0;
    const total = porEstado.reduce((n, x) => n + x._count._all, 0);

    return {
      puedeEscribir: acceso.puedeEscribir,
      kpis: {
        activas: cuenta('pendiente') + cuenta('en_progreso'),
        completadas: cuenta('completada'),
        total,
      },
      implementaciones: filas.map((i) => {
        const hechos = i.items.filter((x) => x.done).length;
        return {
          id: i.id,
          leadId: i.leadId,
          nombre: i.name,
          cliente: i.clientName,
          plan: i.plan,
          estado: i.status,
          entrega: i.dueDate,
          creada: i.createdAt,
          hechos,
          total: i.items.length,
          pasos: i.items.map((x) => ({ id: x.id, titulo: x.title, hecho: x.done })),
        };
      }),
    };
  }

  /** Marca o desmarca un paso y ajusta el estado si toca. */
  async marcarPaso(user: AuthUser, teamId: string, itemId: string, hecho: boolean) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);

    // El paso tiene que ser de una implementación de ESTE equipo. Sin esta
    // comprobación, conociendo un id se podría marcar el paso de otra marca.
    const paso = await this.prisma.salesImplementationItem.findFirst({
      where: { id: itemId, implementation: { salesTeamId: teamId } },
      select: { id: true, implementationId: true },
    });
    if (!paso) throw new NotFoundException('Paso no encontrado');

    await this.prisma.salesImplementationItem.update({
      where: { id: paso.id },
      data: { done: hecho, doneAt: hecho ? new Date() : null, doneByUserId: hecho ? user.id : null },
    });

    const impl = await this.prisma.salesImplementation.findUnique({
      where: { id: paso.implementationId },
      select: { status: true, items: { select: { done: true } } },
    });
    const nuevo = impl ? estadoTrasMarcar(impl.status, impl.items) : null;
    if (nuevo) {
      await this.prisma.salesImplementation.update({
        where: { id: paso.implementationId },
        data: { status: nuevo },
      });
    }
    return { ok: true, estado: nuevo ?? impl?.status ?? null };
  }

  /** Cambia el estado a mano (el selector de la tarjeta). */
  async cambiarEstado(user: AuthUser, teamId: string, implId: string, estado: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    if (!(ESTADOS_DE_IMPLEMENTACION as readonly string[]).includes(estado)) {
      throw new BadRequestException('Estado no válido');
    }
    // `updateMany` con el equipo en el WHERE: si el id es de otro equipo, count
    // sale 0 y se responde como si no existiera.
    const r = await this.prisma.salesImplementation.updateMany({
      where: { id: implId, salesTeamId: teamId },
      data: { status: estado },
    });
    if (r.count === 0) throw new NotFoundException('Implementación no encontrada');
    return { ok: true, estado };
  }

  /**
   * Arranca la implementación de un lead que acaba de cerrar.
   *
   * Idempotente por construcción, no por comprobación: `leadId` es ÚNICO, así
   * que dos llamadas a la vez (mover la tarjeta dos veces, o dos pestañas) no
   * pueden crear dos. La segunda choca con el índice (P2002) y se responde con
   * la que ya estaba. Leer primero y crear después sería la carrera de siempre.
   *
   * Sin `resolveTeamAccess`: la llama `moverLead`, que ya lo hizo. Best-effort
   * desde allí — un fallo aquí no puede deshacer el cierre de una venta.
   */
  async asegurarParaLead(input: {
    teamId: string;
    whiteLabelId: string | null;
    leadId: string;
    cliente: string;
    plan?: string | null;
    creadaPor?: string | null;
  }) {
    const ya = await this.prisma.salesImplementation.findUnique({
      where: { leadId: input.leadId },
      select: { id: true },
    });
    if (ya) return { id: ya.id, nueva: false };

    const ahora = new Date();
    try {
      const impl = await this.prisma.salesImplementation.create({
        data: {
          salesTeamId: input.teamId,
          whiteLabelId: input.whiteLabelId,
          leadId: input.leadId,
          name: `Implementación: ${input.cliente}`,
          clientName: input.cliente,
          plan: input.plan ?? null,
          status: 'pendiente',
          startDate: ahora,
          dueDate: new Date(ahora.getTime() + PLAZO_DIAS * 86_400_000),
          createdByUserId: input.creadaPor ?? null,
          items: {
            create: PASOS_POR_DEFECTO.map((title, position) => ({ title, position })),
          },
        },
        select: { id: true },
      });
      return { id: impl.id, nueva: true };
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        const otra = await this.prisma.salesImplementation.findUnique({
          where: { leadId: input.leadId },
          select: { id: true },
        });
        if (otra) return { id: otra.id, nueva: false };
      }
      throw e;
    }
  }
}
