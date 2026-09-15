import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  CAMPOS_DE_AGENDA,
  camposGuardados,
  configDeAgenda,
  formularioDeAgendaDe,
  normalizarCampos,
  pideDatoDeContacto,
} from './formularios-de-equipo';

/**
 * «Formularios» del equipo: el constructor de TeamClubify.
 *
 * Un formulario es una lista de preguntas (JSON limpio por `normalizarCampos`).
 * El que el equipo elige para su agenda es lo que rellena quien reserva por el
 * enlace público; sus respuestas se guardan enteras y lo que tiene destino en el
 * lead (nombre, teléfono, correo, empresa, Instagram) pasa a su ficha.
 *
 * Cambiar formularios es del líder o un admin de la marca, como en la
 * referencia (el líder toca los de SU equipo). Todo método empieza por
 * `resolveTeamAccess`.
 */

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const SIN_CONTACTO =
  'La agenda necesita una pregunta obligatoria, que se vea siempre, que pase al lead el nombre, o un WhatsApp o un correo (con ese tipo de pregunta). Sin ella la cita se queda sin lead.';

@Injectable()
export class FormulariosDeEquipoService {
  constructor(private prisma: PrismaService) {}

  private puedeConfigurar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  private exigirConfigurar(acceso: AccesoAlEquipo) {
    if (!this.puedeConfigurar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden cambiar los formularios');
    }
  }

  async listar(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const [formularios, equipo] = await Promise.all([
      this.prisma.salesForm.findMany({
        where: { salesTeamId: teamId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { responses: true } } },
      }),
      this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { bookingConfig: true, slug: true } }),
    ]);
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeConfigurar: this.puedeConfigurar(acceso),
      enlaceDeAgenda: equipo?.slug ? `/agenda/${equipo.slug}` : null,
      formularioDeAgenda: formularioDeAgendaDe(equipo?.bookingConfig),
      formularios: formularios.map((f) => ({
        id: f.id,
        nombre: f.name,
        descripcion: f.description,
        activo: f.isActive,
        campos: camposGuardados(f.fields),
        redirectWhatsapp: f.redirectWhatsapp,
        redirectMessage: f.redirectMessage,
        respuestas: f._count.responses,
        creadoEl: f.createdAt,
      })),
    };
  }

  async crear(user: AuthUser, teamId: string, body: { nombre?: string; plantilla?: string }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const nombre = texto(body.nombre, 120);
    if (!nombre) throw new BadRequestException('Ponle nombre al formulario');
    const f = await this.prisma.salesForm.create({
      data: {
        salesTeamId: teamId,
        whiteLabelId: acceso.team.whiteLabelId,
        name: nombre,
        fields: (body.plantilla === 'agenda' ? CAMPOS_DE_AGENDA : []) as unknown as Prisma.InputJsonValue,
        createdByUserId: user.id,
      },
    });
    return { id: f.id };
  }

  async editar(
    user: AuthUser,
    teamId: string,
    id: string,
    body: {
      nombre?: string;
      descripcion?: string | null;
      campos?: unknown;
      activo?: boolean;
      redirectWhatsapp?: string | null;
      redirectMessage?: string | null;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    await this.formularioDelEquipo(teamId, id);
    const data: Prisma.SalesFormUpdateManyMutationInput = {};
    if (body.nombre !== undefined) {
      const n = texto(body.nombre, 120);
      if (!n) throw new BadRequestException('El formulario necesita un nombre');
      data.name = n;
    }
    if (body.descripcion !== undefined) data.description = texto(body.descripcion, 500) || null;
    if (body.campos !== undefined) {
      const c = normalizarCampos(body.campos);
      if (!Array.isArray(c)) throw new BadRequestException(c.error);
      if (!pideDatoDeContacto(c) && (await this.esElDeLaAgenda(teamId, id))) {
        throw new BadRequestException(SIN_CONTACTO);
      }
      data.fields = c as unknown as Prisma.InputJsonValue;
    }
    if (body.activo !== undefined) {
      // Desactivar el de la agenda la devolvía en silencio a nombre y teléfono,
      // con la marca «Agenda» todavía puesta (Fable, 2026-09-15). Como al borrar.
      if (!body.activo && (await this.esElDeLaAgenda(teamId, id))) {
        throw new BadRequestException('Es el formulario de la agenda pública. Quítalo de la agenda antes de desactivarlo.');
      }
      data.isActive = !!body.activo;
    }
    if (body.redirectWhatsapp !== undefined) {
      // Solo dígitos, con indicativo: es lo que espera wa.me.
      data.redirectWhatsapp = (body.redirectWhatsapp ?? '').replace(/\D/g, '').slice(0, 20) || null;
    }
    if (body.redirectMessage !== undefined) data.redirectMessage = texto(body.redirectMessage, 500) || null;
    await this.prisma.salesForm.updateMany({ where: { id, salesTeamId: teamId }, data });
    return { ok: true };
  }

  /**
   * Borrar se niega con respuestas (se desactiva, así no se pierden) y si es el
   * formulario de la agenda (la agenda se quedaría pidiendo algo que no existe).
   */
  async borrar(user: AuthUser, teamId: string, id: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    await this.formularioDelEquipo(teamId, id);
    const [respuestas, equipo] = await Promise.all([
      this.prisma.salesFormResponse.count({ where: { formId: id, salesTeamId: teamId } }),
      this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { bookingConfig: true } }),
    ]);
    if (respuestas > 0) {
      throw new BadRequestException(
        `Este formulario ya tiene ${respuestas} respuesta(s): desactívalo en vez de borrarlo, así no se pierden.`,
      );
    }
    if (formularioDeAgendaDe(equipo?.bookingConfig) === id) {
      throw new BadRequestException('Es el formulario de la agenda pública. Elige otro (o ninguno) antes de borrarlo.');
    }
    try {
      await this.prisma.salesForm.deleteMany({ where: { id, salesTeamId: teamId } });
    } catch (e) {
      // Alguien reservó con él entre la cuenta y el borrado: la clave foránea lo frena.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
        throw new BadRequestException('Este formulario acaba de recibir una respuesta: desactívalo en vez de borrarlo.');
      }
      throw e;
    }
    return { ok: true };
  }

  /** Qué formulario pide la agenda pública del equipo. `null` = el de siempre (nombre y teléfono). */
  async usarEnAgenda(user: AuthUser, teamId: string, body: { formularioId?: string | null }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const formularioId = body.formularioId || null;
    if (formularioId) {
      const f = await this.formularioDelEquipo(teamId, formularioId);
      if (!f.isActive) throw new BadRequestException('Activa el formulario antes de usarlo en la agenda');
      if (!pideDatoDeContacto(camposGuardados(f.fields))) throw new BadRequestException(SIN_CONTACTO);
    }
    // Se lee y se reescribe el JSON del equipo tocando solo esta clave: nada más
    // lo usa hoy, y lo que hubiera se conserva.
    const equipo = await this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { bookingConfig: true } });
    await this.prisma.salesTeam.update({
      where: { id: teamId },
      data: {
        bookingConfig: { ...configDeAgenda(equipo?.bookingConfig), formularioId } as Prisma.InputJsonValue,
      },
    });
    return { ok: true, formularioDeAgenda: formularioId };
  }

  private async formularioDelEquipo(teamId: string, id: string) {
    const f = await this.prisma.salesForm.findFirst({ where: { id, salesTeamId: teamId } });
    if (!f) throw new NotFoundException('Formulario no encontrado');
    return f;
  }

  private async esElDeLaAgenda(teamId: string, id: string): Promise<boolean> {
    const equipo = await this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { bookingConfig: true } });
    return formularioDeAgendaDe(equipo?.bookingConfig) === id;
  }
}
