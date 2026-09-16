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
  SIN_CONTACTO,
  camposGuardados,
  normalizarCampos,
  pideDatoDeContacto,
} from './formularios-de-equipo';

/**
 * «Formularios» del equipo: el constructor de TeamClubify.
 *
 * Un formulario es una lista de preguntas (JSON limpio por `normalizarCampos`).
 * El que elige cada agenda de reserva es lo que rellena quien reserva por su
 * enlace; sus respuestas se guardan enteras y lo que tiene destino en el
 * lead (nombre, teléfono, correo, empresa, Instagram) pasa a su ficha.
 *
 * Cambiar formularios es del líder o un admin de la marca, como en la
 * referencia (el líder toca los de SU equipo). Todo método empieza por
 * `resolveTeamAccess`.
 */

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** «la agenda «Instagram»» o «las agendas «Instagram» y «Referidos»». */
const nombrarAgendas = (nombres: string[]) =>
  nombres.length === 1
    ? `la agenda «${nombres[0]}»`
    : `las agendas ${nombres
        .slice(0, -1)
        .map((n) => `«${n}»`)
        .join(', ')} y «${nombres[nombres.length - 1]}»`;

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
    const [formularios, agendas] = await Promise.all([
      this.prisma.salesForm.findMany({
        where: { salesTeamId: teamId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { responses: true } } },
      }),
      this.prisma.salesAgenda.findMany({
        where: { salesTeamId: teamId, formId: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { formId: true, name: true },
      }),
    ]);
    // Qué agendas de reserva pide cada formulario: se elige en cada agenda y aquí
    // solo se enseña, para que nadie desactive o borre uno que está en uso.
    const agendasPorFormulario: Record<string, string[]> = {};
    for (const a of agendas) if (a.formId) (agendasPorFormulario[a.formId] ??= []).push(a.name);
    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeConfigurar: this.puedeConfigurar(acceso),
      agendasPorFormulario,
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
      if (!pideDatoDeContacto(c) && (await this.agendasQueLoPiden(teamId, id)).length) {
        throw new BadRequestException(SIN_CONTACTO);
      }
      data.fields = c as unknown as Prisma.InputJsonValue;
    }
    if (body.activo !== undefined) {
      // Desactivar el de una agenda la devolvía en silencio a nombre y teléfono,
      // con la marca «Agenda» todavía puesta (Fable, 2026-09-15). Como al borrar.
      const agendas = body.activo ? [] : await this.agendasQueLoPiden(teamId, id);
      if (agendas.length) {
        throw new BadRequestException(
          `Lo pide ${nombrarAgendas(agendas)}: elige otro formulario en esa agenda («Configuración») antes de desactivarlo.`,
        );
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
    const [respuestas, agendas] = await Promise.all([
      this.prisma.salesFormResponse.count({ where: { formId: id, salesTeamId: teamId } }),
      this.agendasQueLoPiden(teamId, id),
    ]);
    if (respuestas > 0) {
      throw new BadRequestException(
        `Este formulario ya tiene ${respuestas} respuesta(s): desactívalo en vez de borrarlo, así no se pierden.`,
      );
    }
    if (agendas.length) {
      throw new BadRequestException(
        `Lo pide ${nombrarAgendas(agendas)}: elige otro formulario (o ninguno) en esa agenda («Configuración») antes de borrarlo.`,
      );
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

  private async formularioDelEquipo(teamId: string, id: string) {
    const f = await this.prisma.salesForm.findFirst({ where: { id, salesTeamId: teamId } });
    if (!f) throw new NotFoundException('Formulario no encontrado');
    return f;
  }

  /** Los nombres de las agendas de reserva del equipo que piden este formulario. */
  private async agendasQueLoPiden(teamId: string, id: string): Promise<string[]> {
    const agendas = await this.prisma.salesAgenda.findMany({
      where: { salesTeamId: teamId, formId: id },
      orderBy: { createdAt: 'asc' },
      select: { name: true },
    });
    return agendas.map((a) => a.name);
  }
}
