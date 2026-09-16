import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { normalizarRoles, resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  CAMPOS_DEL_BANCO,
  COLORES_DE_EQUIPO,
  ESTADOS_DE_EQUIPO,
  MAX_MENSAJE,
  MENSAJE_POR_DEFECTO,
  PESTANAS_DEL_BANCO,
  activoSegunEstado,
  esEstadoDeEquipo,
  estadoDeEquipo,
  leerAjustes,
  normalizarCamposDelBanco,
  normalizarColor,
  normalizarEtiquetas,
} from './configuracion-de-equipo';

/**
 * «Configuración» del equipo: la pestaña de TeamClubify (`TeamSettings` y la
 * configuración del Banco por equipo).
 *
 * Qué se configura: identidad (nombre, descripción, responsable, estado,
 * color), el mensaje con el que el closer abre WhatsApp, y cómo se ve el Banco
 * (nombre de cada pestaña y qué datos enseña una cita).
 *
 * Quién:
 * · Lo del equipo, su líder o un admin de la marca, como en la referencia.
 * · El RESPONSABLE, solo un admin: un líder que se nombra o se quita a sí mismo
 *   es la misma escalada que ya se cerró en Colaboradores.
 * · DESACTIVAR (y reactivar), solo un admin. Un colaborador que desactiva su
 *   equipo deja de verlo en su panel y ya no podría deshacerlo.
 *
 * Lo que la referencia tiene aquí y NO está: la comisión del equipo (las
 * comisiones son de Jhon), la línea de WhatsApp propia del equipo (una marca
 * tiene UNA subcuenta de Grow Business y el webhook entrante no dice por qué
 * número llegó el mensaje). La conexión con Google Calendar tiene su propio
 * servicio (`calendario-de-equipo.service.ts`).
 */

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

@Injectable()
export class ConfiguracionDeEquipoService {
  constructor(private prisma: PrismaService) {}

  private puedeConfigurar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  private exigirConfigurar(acceso: AccesoAlEquipo) {
    if (!this.puedeConfigurar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden cambiar la configuración');
    }
  }

  /**
   * ¿La marca tiene «Automatizaciones» en su menú? La misma regla que el menú
   * (`AppShell`, `requiresBrandModule: 'GROW_BUSINESS_SMS'`): Clubify y lo que no
   * tiene marca lo ven siempre; otra marca, solo con el módulo encendido. Un
   * «Abrir» hacia una pantalla que la marca no tiene en su menú es el mismo
   * fallo que tuvo el menú de Sellea con «Equipos de ventas».
   */
  private async automatizacionesEnElMenu(whiteLabelId: string | null): Promise<boolean> {
    if (!whiteLabelId) return true;
    const [marca, modulo] = await Promise.all([
      this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId }, select: { slug: true } }),
      this.prisma.whiteLabelModule.findUnique({
        where: { whiteLabelId_module: { whiteLabelId, module: 'GROW_BUSINESS_SMS' } },
        select: { enabled: true },
      }),
    ]);
    if (!marca) return false;
    return marca.slug === 'clubify' || !!modulo?.enabled;
  }

  async ver(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const [team, miembros, automatizaciones] = await Promise.all([
      this.prisma.salesTeam.findUnique({
        where: { id: teamId },
        select: {
          id: true,
          name: true,
          description: true,
          color: true,
          status: true,
          isActive: true,
          settings: true,
          leadUserId: true,
          leadUser: { select: { fullName: true } },
        },
      }),
      this.prisma.salesTeamMember.findMany({
        where: { teamId, isActive: true },
        orderBy: { joinedAt: 'asc' },
        select: { userId: true, user: { select: { fullName: true, email: true } } },
      }),
      this.automatizacionesEnElMenu(acceso.team.whiteLabelId),
    ]);
    if (!team) throw new NotFoundException('Equipo no encontrado');
    const ajustes = leerAjustes(team.settings);
    const estado = estadoDeEquipo(team.status, team.isActive);
    return {
      team: {
        id: team.id,
        name: team.name,
        color: team.color,
        isActive: team.isActive,
        status: estado,
        leadUser: team.leadUser ? { fullName: team.leadUser.fullName } : null,
      },
      puedeEscribir: acceso.puedeEscribir,
      puedeConfigurar: this.puedeConfigurar(acceso),
      puedeCambiarResponsable: acceso.esAdminDeMarca,
      puedeDesactivar: acceso.esAdminDeMarca,
      identidad: {
        nombre: team.name,
        descripcion: team.description,
        color: team.color,
        estado,
        responsableId: team.leadUserId,
      },
      // El responsable sale de quienes ya están en el equipo: nombrar a alguien
      // de fuera dejaría un «responsable» que no puede entrar.
      candidatosAResponsable: miembros.map((m) => ({
        id: m.userId,
        nombre: m.user?.fullName || m.user?.email || 'Sin nombre',
      })),
      mensajeWhatsapp: ajustes.mensajeWhatsapp ?? '',
      mensajePorDefecto: MENSAJE_POR_DEFECTO,
      recibeDesconocidos: ajustes.recibeDesconocidos,
      // «Todavía común a todos los equipos» enlaza Automatizaciones solo si la
      // marca la tiene en su menú.
      automatizacionesDeLaMarca: automatizaciones,
      banco: { etiquetas: ajustes.etiquetasDelBanco, campos: ajustes.camposDelBanco },
      catalogos: {
        estados: ESTADOS_DE_EQUIPO,
        colores: COLORES_DE_EQUIPO,
        pestanasDelBanco: PESTANAS_DEL_BANCO,
        camposDelBanco: CAMPOS_DEL_BANCO,
      },
    };
  }

  async guardarIdentidad(
    user: AuthUser,
    teamId: string,
    body: {
      nombre?: string;
      descripcion?: string | null;
      color?: string | null;
      estado?: string;
      responsableId?: string | null;
    },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);

    const data: Prisma.SalesTeamUpdateManyMutationInput = {};
    if (body.nombre !== undefined) {
      const n = texto(body.nombre, 80);
      if (!n) throw new BadRequestException('El nombre del equipo es obligatorio');
      data.name = n;
    }
    if (body.descripcion !== undefined) data.description = texto(body.descripcion, 240) || null;
    if (body.color !== undefined) {
      const c = normalizarColor(body.color);
      if (c && typeof c === 'object') throw new BadRequestException(c.error);
      data.color = c;
    }
    if (body.estado !== undefined) {
      if (!esEstadoDeEquipo(body.estado)) throw new BadRequestException('Ese estado no existe');
      const actual = await this.prisma.salesTeam.findUnique({
        where: { id: teamId },
        select: { status: true, isActive: true },
      });
      const antes = estadoDeEquipo(actual?.status, actual?.isActive ?? true);
      const tocaDesactivado = antes !== body.estado && (antes === 'desactivado' || body.estado === 'desactivado');
      if (tocaDesactivado && !acceso.esAdminDeMarca) {
        throw new ForbiddenException('Solo un admin de la marca puede desactivar o reactivar el equipo');
      }
      data.status = body.estado;
      data.isActive = activoSegunEstado(body.estado);
    }

    if (body.responsableId !== undefined) {
      if (!acceso.esAdminDeMarca) {
        throw new ForbiddenException('Solo un admin de la marca puede cambiar el responsable');
      }
      const responsableId = body.responsableId || null;
      if (responsableId) {
        const miembro = await this.prisma.salesTeamMember.findUnique({
          where: { teamId_userId: { teamId, userId: responsableId } },
          select: { roles: true, isActive: true },
        });
        if (!miembro?.isActive) throw new BadRequestException('El responsable tiene que estar en el equipo');
        // El responsable es líder, como en la referencia: nombrarlo sin poder
        // gestionar su propio equipo no tendría sentido. El responsable ANTERIOR
        // conserva su rol, también como en la referencia: puede ser colíder, y
        // quitarle permisos es otra decisión, que se toma en «Colaboradores».
        const roles = normalizarRoles(miembro.roles);
        await this.prisma.$transaction([
          this.prisma.salesTeam.update({ where: { id: teamId }, data: { ...data, leadUser: { connect: { id: responsableId } } } }),
          this.prisma.salesTeamMember.update({
            where: { teamId_userId: { teamId, userId: responsableId } },
            data: { roles: roles.includes('lider') ? roles : [...roles.filter((r) => r !== 'lectura'), 'lider'] },
          }),
        ]);
        return { ok: true };
      }
      await this.prisma.salesTeam.update({ where: { id: teamId }, data: { ...data, leadUser: { disconnect: true } } });
      return { ok: true };
    }

    if (!Object.keys(data).length) return { ok: true };
    if (acceso.esAdminDeMarca) {
      await this.prisma.salesTeam.update({ where: { id: teamId }, data });
      return { ok: true };
    }
    // El líder escribe SOLO si el equipo sigue activo en ese instante. Se leyó
    // activo al entrar; si un admin lo desactivó entre esa lectura y esta
    // escritura, un `update` a secas lo reactivaba (Fable, 2026-09-15).
    const hecho = await this.prisma.salesTeam.updateMany({ where: { id: teamId, isActive: true }, data });
    if (hecho.count === 0) {
      throw new ForbiddenException('El equipo acaba de desactivarse: ya no se puede cambiar su configuración');
    }
    return { ok: true };
  }

  async guardarMensaje(
    user: AuthUser,
    teamId: string,
    body: { mensaje?: string | null; recibeDesconocidos?: boolean },
  ) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const m = texto(body.mensaje, MAX_MENSAJE);
    // Vacío o igual al de siempre se guarda como «el de siempre».
    const parche: Record<string, unknown> = { mensajeWhatsapp: m && m !== MENSAJE_POR_DEFECTO ? m : null };
    if (body.recibeDesconocidos !== undefined) parche.recibeDesconocidos = !!body.recibeDesconocidos;
    await this.fusionarAjustes(teamId, parche);
    if (body.recibeDesconocidos === true && acceso.team.whiteLabelId) {
      // Una sola bandeja por marca. Con dos marcadas ganaba el equipo más
      // antiguo, y el que acababa de marcarlo no recibía nada ni se enteraba
      // (Fable, 2026-09-15).
      await this.prisma.$executeRaw`
        UPDATE "SalesTeam"
           SET "settings" = COALESCE("settings", '{}'::jsonb) - 'recibeDesconocidos'
         WHERE "whiteLabelId" = ${acceso.team.whiteLabelId}
           AND "id" <> ${teamId}`;
    }
    return { ok: true };
  }

  async guardarBanco(user: AuthUser, teamId: string, body: { etiquetas?: unknown; campos?: unknown }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const parche: Record<string, unknown> = {};
    if (body.etiquetas !== undefined) {
      const e = normalizarEtiquetas(body.etiquetas);
      if ('error' in e && typeof e.error === 'string') throw new BadRequestException(e.error);
      parche.etiquetasDelBanco = e;
    }
    if (body.campos !== undefined) {
      const c = normalizarCamposDelBanco(body.campos);
      if (!Array.isArray(c)) throw new BadRequestException(c.error);
      parche.camposDelBanco = c;
    }
    if (Object.keys(parche).length) await this.fusionarAjustes(teamId, parche);
    return { ok: true };
  }

  /**
   * Mezcla claves en `settings` en UNA sentencia. Leer el JSON, mezclarlo en
   * memoria y escribirlo entero pisaba lo que otra persona guardara a la vez
   * en otra tarjeta de la misma pantalla.
   */
  private async fusionarAjustes(teamId: string, parche: Record<string, unknown>) {
    await this.prisma.$executeRaw`
      UPDATE "SalesTeam"
         SET "settings" = COALESCE("settings", '{}'::jsonb) || ${JSON.stringify(parche)}::jsonb,
             "updatedAt" = NOW()
       WHERE "id" = ${teamId}`;
  }
}
