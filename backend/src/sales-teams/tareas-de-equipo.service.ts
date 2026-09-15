import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { fechaEn } from '../common/franjas-horarias';
import { exigirEscritura, resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  ACCION_INICIAL,
  estaVencida,
  normalizarAccion,
  normalizarFecha,
  normalizarVista,
  whereDeTareas,
} from './tareas-de-equipo';

/**
 * «Tareas del CRM» del equipo, como en TeamClubify.
 *
 * Lo que hay que hacer con un contacto, con fecha y responsable: «Llamar el
 * lunes», «Mandar la propuesta». Antes eso vivía en una nota del lead y nadie
 * lo veía vencer. La acción sale de un catálogo del equipo (títulos cortos, que
 * se repiten) y el detalle, en la descripción.
 *
 * Todo método empieza por `resolveTeamAccess`. Las reglas puras viven en
 * `tareas-de-equipo.ts`.
 */

const ZONA = 'America/Bogota';
const TOPE = 300;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

@Injectable()
export class TareasDeEquipoService {
  constructor(private prisma: PrismaService) {}

  private esLiderOAdmin(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  async listar(user: AuthUser, teamId: string, raw: { vista?: string; lead?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const hoy = fechaEn(new Date(), ZONA);
    const vista = normalizarVista(raw.vista);
    // Con `lead`, las del contacto (para su ficha), abiertas primero. Si no, la vista.
    const where: Prisma.SalesTaskWhereInput = raw.lead
      ? { salesTeamId: teamId, leadId: raw.lead }
      : whereDeTareas(teamId, vista, hoy, user.id);
    const orden: Prisma.SalesTaskOrderByWithRelationInput[] = raw.lead
      ? [{ done: 'asc' }, { createdAt: 'desc' }]
      : [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }];

    const [filas, pendientes, miembros, acciones] = await Promise.all([
      this.prisma.salesTask.findMany({
        where,
        orderBy: orden,
        take: TOPE,
        include: { lead: { select: { id: true, name: true, phone: true, company: true } } },
      }),
      this.prisma.salesTask.count({ where: { salesTeamId: teamId, done: false } }),
      // Nombres por la membresía: `User` pasa por el filtro de negocio.
      this.prisma.salesTeamMember.findMany({
        where: { teamId },
        select: { userId: true, isActive: true, user: { select: { fullName: true } } },
      }),
      this.acciones(teamId),
    ]);

    const nombre = new Map(miembros.map((m) => [m.userId, m.user?.fullName ?? 'Sin nombre']));
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeBorrarTodas: this.esLiderOAdmin(acceso),
      yo: user.id,
      hoy,
      vista,
      pendientes,
      truncado: filas.length === TOPE,
      responsables: miembros
        .filter((m) => m.isActive)
        .map((m) => ({ id: m.userId, nombre: m.user?.fullName ?? 'Sin nombre' }))
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      acciones: acciones.map((a) => ({ id: a.id, nombre: a.name })),
      tareas: filas.map((t) => ({
        id: t.id,
        titulo: t.title,
        descripcion: t.body,
        fecha: t.dueDate,
        hecha: t.done,
        hechaEl: t.doneAt,
        vencida: estaVencida({ done: t.done, dueDate: t.dueDate }, hoy),
        responsableId: t.assignedUserId,
        responsable: t.assignedUserId ? (nombre.get(t.assignedUserId) ?? 'Fuera del equipo') : null,
        creadaPor: t.createdByUserId,
        creadaEl: t.createdAt,
        lead: t.lead
          ? { id: t.lead.id, nombre: t.lead.name, telefono: t.lead.phone, empresa: t.lead.company }
          : null,
      })),
    };
  }

  async crear(
    user: AuthUser,
    teamId: string,
    body: { leadId?: string; titulo?: string; descripcion?: string | null; fecha?: string | null; responsableId?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const lead = await this.prisma.salesLead.findFirst({
      where: { id: body.leadId ?? '', salesTeamId: teamId },
      select: { id: true },
    });
    if (!lead) throw new NotFoundException('Contacto no encontrado');
    const titulo = normalizarAccion(body.titulo);
    if (typeof titulo !== 'string') throw new BadRequestException(titulo.error);
    const fecha = normalizarFecha(body.fecha);
    if (fecha !== null && typeof fecha === 'object') throw new BadRequestException(fecha.error);
    await this.exigirMiembroActivo(teamId, body.responsableId);

    const t = await this.prisma.salesTask.create({
      data: {
        salesTeamId: teamId,
        leadId: lead.id,
        title: titulo,
        body: texto(body.descripcion, 4000) || null,
        dueDate: fecha,
        assignedUserId: body.responsableId || null,
        createdByUserId: user.id,
      },
    });
    await this.anotar(lead.id, teamId, user.id, `Tarea «${titulo}»${fecha ? ` para el ${fecha}` : ''}`);
    return { ok: true, id: t.id };
  }

  async editar(
    user: AuthUser,
    teamId: string,
    id: string,
    body: { titulo?: string; descripcion?: string | null; fecha?: string | null; responsableId?: string | null },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    await this.tareaDelEquipo(teamId, id);
    const data: Prisma.SalesTaskUpdateManyMutationInput = {};
    if (body.titulo !== undefined) {
      const t = normalizarAccion(body.titulo);
      if (typeof t !== 'string') throw new BadRequestException(t.error);
      data.title = t;
    }
    if (body.descripcion !== undefined) data.body = texto(body.descripcion, 4000) || null;
    if (body.fecha !== undefined) {
      const f = normalizarFecha(body.fecha);
      if (f !== null && typeof f === 'object') throw new BadRequestException(f.error);
      data.dueDate = f;
    }
    if (body.responsableId !== undefined) {
      await this.exigirMiembroActivo(teamId, body.responsableId);
      data.assignedUserId = body.responsableId || null;
    }
    await this.prisma.salesTask.updateMany({ where: { id, salesTeamId: teamId }, data });
    return { ok: true };
  }

  /**
   * Marca o desmarca. Condicional sobre el estado contrario: dos clics seguidos
   * no pisan la fecha en que se cerró.
   */
  async marcar(user: AuthUser, teamId: string, id: string, body: { hecha?: boolean }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const hecha = !!body.hecha;
    const r = await this.prisma.salesTask.updateMany({
      where: { id, salesTeamId: teamId, done: !hecha },
      data: { done: hecha, doneAt: hecha ? new Date() : null },
    });
    if (!r.count) {
      await this.tareaDelEquipo(teamId, id);
      return { ok: true, sinCambios: true };
    }
    return { ok: true };
  }

  /**
   * La borra quien la creó, el líder o un admin de la marca: una tarea ajena
   * borrada es un compromiso con un cliente que ya nadie recuerda.
   */
  async borrar(user: AuthUser, teamId: string, id: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const t = await this.tareaDelEquipo(teamId, id);
    if (!this.esLiderOAdmin(acceso) && t.createdByUserId !== user.id) {
      throw new ForbiddenException(
        'Solo quien creó la tarea, el líder del equipo o un admin de la marca pueden eliminarla',
      );
    }
    await this.prisma.salesTask.deleteMany({ where: { id, salesTeamId: teamId } });
    return { ok: true };
  }

  // ── Catálogo de acciones ────────────────────────────────────────────────

  async listarAcciones(user: AuthUser, teamId: string) {
    await resolveTeamAccess(this.prisma, user, teamId);
    const acciones = await this.acciones(teamId);
    return { acciones: acciones.map((a) => ({ id: a.id, nombre: a.name })) };
  }

  /** Añade una acción al catálogo. Si ya estaba (aunque cambien mayúsculas), la reutiliza. */
  async crearAccion(user: AuthUser, teamId: string, body: { nombre?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    exigirEscritura(acceso);
    const nombre = normalizarAccion(body.nombre);
    if (typeof nombre !== 'string') throw new BadRequestException(nombre.error);
    const igual = await this.prisma.salesTaskAction.findFirst({
      where: { salesTeamId: teamId, name: { equals: nombre, mode: 'insensitive' } },
    });
    if (igual) return { id: igual.id, nombre: igual.name };
    const cuantas = await this.prisma.salesTaskAction.count({ where: { salesTeamId: teamId } });
    try {
      const a = await this.prisma.salesTaskAction.create({
        data: { salesTeamId: teamId, name: nombre, position: cuantas },
      });
      return { id: a.id, nombre: a.name };
    } catch (e) {
      // Otra persona la creó en el mismo instante: el índice único lo frena y
      // se devuelve la que ya hay.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const ya = await this.prisma.salesTaskAction.findFirst({ where: { salesTeamId: teamId, name: nombre } });
        if (ya) return { id: ya.id, nombre: ya.name };
      }
      throw e;
    }
  }

  /** Quitar del catálogo no toca las tareas ya creadas: conservan su título. */
  async borrarAccion(user: AuthUser, teamId: string, accionId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    if (!this.esLiderOAdmin(acceso)) {
      throw new ForbiddenException(
        'Solo el líder del equipo o un admin de la marca pueden quitar acciones del catálogo',
      );
    }
    const r = await this.prisma.salesTaskAction.deleteMany({ where: { id: accionId, salesTeamId: teamId } });
    if (!r.count) throw new NotFoundException('Acción no encontrada');
    return { ok: true };
  }

  // ── Ayudas ──────────────────────────────────────────────────────────────

  /**
   * El catálogo del equipo, sembrando «Seguimiento» la primera vez para que la
   * lista nunca salga vacía. El índice único (equipo, nombre) y `skipDuplicates`
   * hacen que dos primeras visitas a la vez no lo dupliquen.
   */
  private async acciones(teamId: string) {
    const leer = () =>
      this.prisma.salesTaskAction.findMany({
        where: { salesTeamId: teamId },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
    const hay = await leer();
    if (hay.length) return hay;
    await this.prisma.salesTaskAction.createMany({
      data: [{ salesTeamId: teamId, name: ACCION_INICIAL, position: 0 }],
      skipDuplicates: true,
    });
    return leer();
  }

  private async tareaDelEquipo(teamId: string, id: string) {
    const t = await this.prisma.salesTask.findFirst({ where: { id, salesTeamId: teamId } });
    if (!t) throw new NotFoundException('Tarea no encontrada');
    return t;
  }

  private async exigirMiembroActivo(teamId: string, userId?: string | null) {
    if (!userId) return;
    const m = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { isActive: true },
    });
    if (!m?.isActive) throw new BadRequestException('Esa persona no está en el equipo');
  }

  /** Deja rastro en la ficha del lead y lo marca como activo. Nunca tumba la acción. */
  private async anotar(leadId: string, teamId: string, userId: string, body: string) {
    await Promise.all([
      this.prisma.salesLeadActivity
        .create({ data: { leadId, salesTeamId: teamId, userId, kind: 'nota', body } })
        .catch(() => null),
      this.prisma.salesLead
        .updateMany({ where: { id: leadId, salesTeamId: teamId }, data: { lastActivityAt: new Date() } })
        .catch(() => null),
    ]);
  }
}
