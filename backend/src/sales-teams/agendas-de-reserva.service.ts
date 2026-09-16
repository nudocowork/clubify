import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import {
  ANTELACIONES,
  DURACIONES,
  HORARIO_DE_AGENDA_NUEVA,
  MAX_CUPOS_POR_HORARIO,
  MAX_DIAS_HACIA_ADELANTE,
  PASOS,
  SEGUNDOS_DE_REDIRECCION,
} from './ajustes-de-agenda';
import {
  COLORES_DE_AGENDA,
  MAX_AGENDAS_POR_EQUIPO,
  agendaParaElPanel,
  errorDeSlug,
  normalizarAgenda,
  primerSlugLibre,
  raizDeSlug,
  slugDeAgenda,
} from './agendas-de-reserva';
import { SIN_CONTACTO, camposGuardados, pideDatoDeContacto } from './formularios-de-equipo';

/**
 * «Agendas de reserva del equipo» (Configuración): varias agendas públicas por
 * equipo, cada una con su enlace, horario y formulario.
 *
 * Las ve cualquiera del equipo; las cambia el líder o un admin de la marca, como
 * el resto de la configuración. Todo método empieza por `resolveTeamAccess`.
 *
 * DOS COSAS QUE NO SON OBVIAS
 * ---------------------------
 * 1. **El slug no puede ser el de OTRO equipo**, aunque ninguna agenda lo use:
 *    la página pública busca primero la agenda y, si no la hay, cae al slug del
 *    equipo. Una agenda nueva con ese nombre taparía el enlace que ese equipo
 *    repartió cuando tenía una sola agenda.
 * 2. **Guardar va con candado por agenda.** Los ajustes son un JSON que se
 *    mezcla con lo guardado: sin candado, dos guardados a la vez leían lo mismo
 *    y el segundo borraba lo que había escrito el primero.
 */

const ENLACE_OCUPADO = 'Ese enlace ya está en uso. Elige otro.';
const EQUIPO_DESACTIVADO = 'El equipo acaba de desactivarse: ya no se puede cambiar su configuración';

const esSlugRepetido = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class AgendasDeReservaService {
  constructor(private prisma: PrismaService) {}

  private puedeConfigurar(acceso: AccesoAlEquipo): boolean {
    return acceso.puedeEscribir && (acceso.esAdminDeMarca || acceso.roles.includes('lider'));
  }

  private exigirConfigurar(acceso: AccesoAlEquipo) {
    if (!this.puedeConfigurar(acceso)) {
      throw new ForbiddenException('Solo el líder del equipo o un admin de la marca pueden cambiar las agendas de reserva');
    }
  }

  async listar(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const [agendas, formularios, equipo] = await Promise.all([
      this.prisma.salesAgenda.findMany({ where: { salesTeamId: teamId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.salesForm.findMany({
        where: { salesTeamId: teamId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, isActive: true, fields: true },
      }),
      this.prisma.salesTeam.findUnique({ where: { id: teamId }, select: { slug: true } }),
    ]);
    return {
      team: acceso.team,
      puedeConfigurar: this.puedeConfigurar(acceso),
      nombreDelEquipo: acceso.team.name,
      // El enlace que el equipo repartía cuando tenía una sola agenda. Apagar la
      // agenda que lo lleva lo cierra, porque la página pública no cae al equipo
      // si la agenda existe apagada: la pantalla lo avisa antes de guardar.
      slugDelEquipo: equipo?.slug ?? null,
      agendas: agendas.map((a) => agendaParaElPanel(a)),
      // Solo se elige uno activo que asegure un dato de contacto: sin él, la
      // reserva saldría sin lead. Va la lista entera para enseñar el ya elegido.
      formularios: formularios.map((f) => ({
        id: f.id,
        nombre: f.name,
        usable: f.isActive && pideDatoDeContacto(camposGuardados(f.fields)),
      })),
      opciones: {
        duraciones: DURACIONES,
        antelaciones: ANTELACIONES,
        maxDias: MAX_DIAS_HACIA_ADELANTE,
        redirecciones: SEGUNDOS_DE_REDIRECCION,
        pasos: PASOS,
        maxCupos: MAX_CUPOS_POR_HORARIO,
        colores: COLORES_DE_AGENDA,
      },
    };
  }

  /** «+ Nueva agenda». Nace activa, con el horario por defecto y sin formulario. */
  async crear(user: AuthUser, teamId: string, body: { nombre?: string; slug?: string | null }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim().slice(0, 80) : '';
    if (!nombre) throw new BadRequestException('Ponle nombre a la agenda');

    let slug: string;
    if (typeof body.slug === 'string' && body.slug.trim()) {
      slug = slugDeAgenda(body.slug);
      const error = errorDeSlug(slug);
      if (error) throw new BadRequestException(error);
      await this.exigirEnlaceLibre(slug, teamId, null);
    } else {
      slug = await this.enlaceLibreDesde(nombre, teamId);
    }

    try {
      const creada = await this.prisma.$transaction(async (tx) => {
        // Candado por equipo: dos «Nueva agenda» a la vez contaban las mismas y
        // se pasaban del tope.
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `agendas:${teamId}`);
        // Condicional, como «Configuración»: si un admin desactivó el equipo tras
        // comprobar los permisos, el líder ya no estrena agendas.
        const equipo = await tx.salesTeam.findFirst({
          where: { id: teamId, ...(acceso.esAdminDeMarca ? {} : { isActive: true }) },
          select: { id: true },
        });
        if (!equipo) throw new ForbiddenException(EQUIPO_DESACTIVADO);
        if ((await tx.salesAgenda.count({ where: { salesTeamId: teamId } })) >= MAX_AGENDAS_POR_EQUIPO) {
          throw new BadRequestException(`Un equipo puede tener hasta ${MAX_AGENDAS_POR_EQUIPO} agendas`);
        }
        return tx.salesAgenda.create({
          data: {
            salesTeamId: teamId,
            whiteLabelId: acceso.team.whiteLabelId,
            slug,
            name: nombre,
            createdByUserId: user.id,
            settings: { franjas: HORARIO_DE_AGENDA_NUEVA } as unknown as Prisma.InputJsonValue,
          },
        });
      });
      return agendaParaElPanel(creada);
    } catch (e) {
      // Otra agenda cogió el mismo enlace entre la comprobación y el alta: lo
      // frena el índice único, y se responde como si se hubiera visto antes.
      if (esSlugRepetido(e)) throw new ConflictException(ENLACE_OCUPADO);
      throw e;
    }
  }

  /** «Configurar»: cualquier dato de la agenda. Solo cambia lo que llega. */
  async editar(user: AuthUser, teamId: string, agendaId: string, body: unknown) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const cambios = normalizarAgenda(body);
    if ('error' in cambios) throw new BadRequestException(cambios.error);
    const actual = await this.prisma.salesAgenda.findFirst({
      where: { id: agendaId, salesTeamId: teamId },
      select: { id: true, slug: true },
    });
    if (!actual) throw new NotFoundException('Agenda no encontrada');

    const { columnas, ajustes } = cambios;
    if (columnas.slug !== undefined) {
      if (columnas.slug === actual.slug) delete columnas.slug;
      else await this.exigirEnlaceLibre(columnas.slug, teamId, agendaId);
    }
    if (columnas.formId) await this.exigirFormularioUsable(teamId, columnas.formId);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `agenda:${agendaId}`);
        const fila = await tx.salesAgenda.findFirst({
          where: { id: agendaId, salesTeamId: teamId },
          select: { settings: true },
        });
        if (!fila) throw new NotFoundException('Agenda no encontrada');
        const guardados =
          fila.settings && typeof fila.settings === 'object' && !Array.isArray(fila.settings)
            ? (fila.settings as Record<string, unknown>)
            : {};
        const r = await tx.salesAgenda.updateMany({
          // Condicional sobre el equipo activo, por lo mismo que al crear.
          where: { id: agendaId, salesTeamId: teamId, ...(acceso.esAdminDeMarca ? {} : { team: { isActive: true } }) },
          data: { ...columnas, settings: { ...guardados, ...ajustes } as unknown as Prisma.InputJsonValue },
        });
        if (r.count === 0) throw new ForbiddenException(EQUIPO_DESACTIVADO);
      });
    } catch (e) {
      if (esSlugRepetido(e)) throw new ConflictException(ENLACE_OCUPADO);
      throw e;
    }
    const guardada = await this.prisma.salesAgenda.findFirst({ where: { id: agendaId, salesTeamId: teamId } });
    if (!guardada) throw new NotFoundException('Agenda no encontrada');
    return agendaParaElPanel(guardada);
  }

  /** Borrar una agenda cierra su enlace. Las citas que vinieron de ella se quedan. */
  async borrar(user: AuthUser, teamId: string, agendaId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirConfigurar(acceso);
    const existe = await this.prisma.salesAgenda.findFirst({
      where: { id: agendaId, salesTeamId: teamId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Agenda no encontrada');
    await this.prisma.$transaction(async (tx) => {
      // El mismo candado que guardar: no se borra a mitad de un guardado.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `agenda:${agendaId}`);
      const r = await tx.salesAgenda.deleteMany({
        where: { id: agendaId, salesTeamId: teamId, ...(acceso.esAdminDeMarca ? {} : { team: { isActive: true } }) },
      });
      if (r.count === 0) throw new ForbiddenException(EQUIPO_DESACTIVADO);
    });
    return { ok: true };
  }

  /**
   * El enlace no puede ser de otra agenda ni el slug de OTRO equipo (ver arriba).
   * El mismo mensaje en los dos casos y sin decir de quién es: el enlace de otra
   * marca no se confirma.
   */
  private async exigirEnlaceLibre(slug: string, teamId: string, agendaId: string | null) {
    const [agenda, otroEquipo] = await Promise.all([
      this.prisma.salesAgenda.findUnique({ where: { slug }, select: { id: true } }),
      this.prisma.salesTeam.findFirst({ where: { slug, id: { not: teamId } }, select: { id: true } }),
    ]);
    if ((agenda && agenda.id !== agendaId) || otroEquipo) throw new ConflictException(ENLACE_OCUPADO);
  }

  /** Sin enlace escrito, sale del nombre con sufijo hasta que entre. */
  private async enlaceLibreDesde(nombre: string, teamId: string): Promise<string> {
    const raiz = raizDeSlug(nombre);
    const [agendas, equipos] = await Promise.all([
      this.prisma.salesAgenda.findMany({ where: { slug: { startsWith: raiz } }, select: { slug: true } }),
      this.prisma.salesTeam.findMany({
        where: { slug: { startsWith: raiz }, id: { not: teamId } },
        select: { slug: true },
      }),
    ]);
    const ocupados = new Set<string>([
      ...agendas.map((a) => a.slug),
      ...equipos.map((t) => t.slug).filter((s): s is string => !!s),
    ]);
    const libre = primerSlugLibre(raiz, ocupados);
    if (!libre) throw new BadRequestException('No queda un enlace libre con ese nombre: escribe uno');
    return libre;
  }

  /** El formulario de una agenda: de este equipo, activo y con un dato de contacto. */
  private async exigirFormularioUsable(teamId: string, formId: string) {
    const f = await this.prisma.salesForm.findFirst({
      where: { id: formId, salesTeamId: teamId },
      select: { isActive: true, fields: true },
    });
    if (!f) throw new NotFoundException('Formulario no encontrado');
    if (!f.isActive) throw new BadRequestException('Activa el formulario antes de usarlo en la agenda');
    if (!pideDatoDeContacto(camposGuardados(f.fields))) throw new BadRequestException(SIN_CONTACTO);
  }
}
