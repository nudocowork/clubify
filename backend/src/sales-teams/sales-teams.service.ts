import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
import {
  metricasDeEquipos,
  METRICAS_EN_CERO,
} from './metricas-de-equipo';
import { TenantContext } from '../common/tenant/tenant-context';
import { normalizarRoles } from './team-access';

/**
 * Equipos de ventas (C4). Solo el super admin los gestiona desde
 * /admin/sales-teams. Los miembros mantienen su CRM individual — el
 * equipo es agrupación administrativa + scope para métricas y
 * asignaciones a tenants (B3/B5).
 */
@Injectable()
export class SalesTeamsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lista todos los equipos con counter de miembros + datos del lead.
   * Ordenados por createdAt desc para que los nuevos aparezcan arriba.
   */
  async list(user: AuthUser) {
    // La marca del equipo es AHORA una columna suya.
    //
    // Antes se deducía del código de referido de su líder o de sus miembros, y
    // eso tenía dos agujeros: un equipo sin líder ni miembros no era de nadie,
    // y —lo importante— si la sesión no traía marca, el `where` se quedaba
    // VACÍO y devolvía TODOS los equipos de todas las marcas.
    //
    // `resolveBrandScope` es la regla que ya usa el resto del panel: sin marca
    // en la sesión se cae a Clubify, nunca a «ver todo». Clubify incluye los
    // equipos antiguos sin marca resuelta; las demás marcas, estricto.
    const { wlId, isClubify } = await resolveBrandScope(
      this.prisma,
      user.whiteLabelId,
    );
    const teams = await this.prisma.salesTeam.findMany({
      where: isClubify
        ? { OR: [{ whiteLabelId: wlId }, { whiteLabelId: null }] }
        : { whiteLabelId: wlId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { members: true } },
        leadUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    // Las cifras de cada equipo, en consultas agrupadas (ver
    // `metricas-de-equipo.ts`). Sin ellas la lista solo decía el nombre y «0
    // miembros», que no permite decidir nada.
    const metricas = await metricasDeEquipos(
      this.prisma,
      teams.map((t) => t.id),
    );
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      color: t.color,
      isActive: t.isActive,
      status: t.status,
      leadUser: t.leadUser,
      memberCount: t._count.members,
      createdAt: t.createdAt,
      metricas: metricas.get(t.id) ?? METRICAS_EN_CERO,
    }));
  }

  /**
   * El equipo, comprobando que sea DE TU MARCA.
   *
   * Antes no recibía el usuario y no miraba la marca: un super admin de Sellea
   * podía leer, editar y borrar un equipo de Clubify con solo saber su id. Los
   * métodos de escritura llamaban a este `get` creyendo que validaba, y solo
   * validaba que existiera.
   *
   * El usuario es OBLIGATORIO desde el 2026-09-10. Antes era opcional «por si
   * alguien lo llama por dentro», y la ruta `GET /admin/sales-teams/:id` no se
   * lo pasaba: la escritura quedó cerrada y la lectura abierta durante dos
   * días. Un parámetro opcional en una comprobación de seguridad es una puerta
   * que alguien vuelve a dejar abierta sin querer.
   */
  async get(id: string, user: AuthUser) {
    await this.exigirMiMarca(id, user);
    const team = await this.prisma.salesTeam.findUnique({
      where: { id },
      include: {
        leadUser: { select: { id: true, fullName: true, email: true } },
        members: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!team) throw new NotFoundException('Equipo no encontrado');
    return team;
  }

  /**
   * Lanza 404 si el equipo no es de la marca de quien pregunta.
   *
   * 404 y no 403 a propósito: un 403 confirmaría que ese id existe.
   */
  private async exigirMiMarca(id: string, user: AuthUser): Promise<void> {
    const team = await this.prisma.salesTeam.findUnique({
      where: { id },
      select: { whiteLabelId: true },
    });
    if (!team) throw new NotFoundException('Equipo no encontrado');
    const { wlId, isClubify } = await resolveBrandScope(
      this.prisma,
      user.whiteLabelId,
    );
    const esMio =
      team.whiteLabelId === wlId || (isClubify && team.whiteLabelId === null);
    if (!esMio) throw new NotFoundException('Equipo no encontrado');
  }

  async create(user: AuthUser, body: { name: string; leadUserId?: string | null }) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    if (body.leadUserId) {
      const lead = await this.prisma.user.findUnique({
        where: { id: body.leadUserId },
        select: { id: true },
      });
      if (!lead) throw new BadRequestException('Lead user no existe');
    }
    // La marca sale de la SESIÓN, nunca del cuerpo de la petición: si la
    // eligiera quien llama, el aislamiento lo pondría el atacante.
    const { wlId } = await resolveBrandScope(this.prisma, user.whiteLabelId);
    return this.prisma.salesTeam.create({
      data: {
        name: name.slice(0, 80),
        leadUserId: body.leadUserId ?? null,
        whiteLabelId: wlId,
      },
      include: {
        leadUser: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async update(
    id: string,
    user: AuthUser,
    body: { name?: string; leadUserId?: string | null },
  ) {
    await this.exigirMiMarca(id, user);
    if (body.leadUserId) {
      const lead = await this.prisma.user.findUnique({
        where: { id: body.leadUserId },
        select: { id: true },
      });
      if (!lead) throw new BadRequestException('Lead user no existe');
    }
    const actualizado = await this.prisma.salesTeam.update({
      where: { id },
      data: {
        name:
          body.name === undefined
            ? undefined
            : body.name.trim().slice(0, 80) || undefined,
        leadUserId:
          body.leadUserId === undefined ? undefined : body.leadUserId,
      },
      include: {
        leadUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    // El responsable queda como líder si ya está en el equipo, igual que desde
    // «Configuración». Nombrado desde aquí era responsable sin poder gestionar
    // nada (Fable, 2026-09-15). Si no es miembro, se le añade en «Colaboradores».
    if (body.leadUserId) {
      const miembro = await this.prisma.salesTeamMember.findUnique({
        where: { teamId_userId: { teamId: id, userId: body.leadUserId } },
        select: { roles: true, isActive: true },
      });
      const roles = normalizarRoles(miembro?.roles);
      if (miembro?.isActive && !roles.includes('lider')) {
        await this.prisma.salesTeamMember.update({
          where: { teamId_userId: { teamId: id, userId: body.leadUserId } },
          data: { roles: [...roles.filter((r) => r !== 'lectura'), 'lider'] },
        });
      }
    }
    return actualizado;
  }

  async remove(id: string, user: AuthUser) {
    await this.exigirMiMarca(id, user);

    // NO se borra un equipo que todavía tiene ventas con negocio vinculado.
    //
    // `SalesLead.team` es `onDelete: Cascade`: borrar el equipo se lleva sus
    // leads, y como `SalesTeamSale.leadId` es `ON DELETE SET NULL`, TODAS sus
    // ventas se quedarían `estado='vinculada'` y sin lead. Ahí no las ve nadie
    // —la pantalla de Clientes y `desvincular` las buscan por `leadId`— pero el
    // índice único parcial sigue dando esos negocios por ocupados: ninguno se
    // podría volver a vincular nunca, y sin pantalla desde la que soltarlos.
    //
    // Se niega en vez de desvincularlas en cascada, por lo mismo que en
    // `sales-leads.service.ts` (`borrarLead`): esa venta es lo que luego se
    // cobra, y la atribución de quién cerró no se pierde en silencio por un
    // borrado hecho desde OTRA pantalla (aquí, /admin/sales-teams).
    const vinculadas = await this.prisma.salesTeamSale.count({
      where: { salesTeamId: id, estado: 'vinculada' },
    });
    if (vinculadas > 0) {
      throw new ConflictException(
        vinculadas === 1
          ? 'Este equipo tiene 1 venta con un negocio vinculado. Desvincúlala desde su pestaña Clientes antes de borrar el equipo: esa venta es la que se cobra después.'
          : `Este equipo tiene ${vinculadas} ventas con un negocio vinculado. Desvincúlalas desde su pestaña Clientes antes de borrar el equipo: esas ventas son las que se cobran después.`,
      );
    }

    // Cascade en SalesTeamMember se encarga de los memberships.
    await this.prisma.salesTeam.delete({ where: { id } });
    return { ok: true };
  }

  async addMember(
    teamId: string,
    quien: AuthUser,
    userId: string,
    roles?: string[],
  ) {
    await this.exigirMiMarca(teamId, quien);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('User no existe');
    // Sin rol explícito entra como `lectura`: lo más restrictivo. Dar permisos
    // por omisión es como se acaban colando escrituras que nadie autorizó.
    const limpios = normalizarRoles(roles);
    try {
      return await this.prisma.salesTeamMember.create({
        data: { teamId, userId, roles: limpios.length ? limpios : ['lectura'] },
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true } },
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('El usuario ya pertenece a este equipo');
      }
      throw e;
    }
  }

  /** Cambia los roles de un miembro. Sin roles válidos, queda en `lectura`. */
  async setMemberRoles(
    teamId: string,
    quien: AuthUser,
    userId: string,
    roles: string[],
  ) {
    await this.exigirMiMarca(teamId, quien);
    const limpios = normalizarRoles(roles);
    const member = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { id: true },
    });
    if (!member) throw new NotFoundException('El usuario no está en este equipo');
    return this.prisma.salesTeamMember.update({
      where: { id: member.id },
      data: { roles: limpios.length ? limpios : ['lectura'] },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
      },
    });
  }

  async removeMember(teamId: string, quien: AuthUser, userId: string) {
    await this.exigirMiMarca(teamId, quien);
    const member = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!member) {
      throw new NotFoundException('El usuario no está en este equipo');
    }
    await this.prisma.salesTeamMember.delete({ where: { id: member.id } });
    return { ok: true };
  }

  /**
   * Lista usuarios elegibles para ser miembros — afiliados que
   * todavía NO están en este equipo. Filtramos por role AFFILIATE_*
   * por ahora (cuando agreguemos vendedores internos en una iteración
   * futura, agregamos esos roles aquí). Excluye al lead user del team
   * de la lista de members elegibles (puede ser lead pero no necesita
   * ser miembro adicionalmente).
   */
  async listEligibleUsers(user: AuthUser, teamId?: string) {
    const alcance = await resolveBrandScope(this.prisma, user.whiteLabelId);
    const where: any = {
      role: {
        in: ['AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO'],
      },
      isActive: true,
      // Aislamiento por marca. Se resuelve con `resolveBrandScope`, NO con
      // `user.whiteLabelId` a pelo: con la sesión sin marca, ese campo es null
      // y el `where` se quedaba sin la condición entera — o sea, listaba los
      // afiliados de TODAS las marcas con su nombre y su correo. Es el mismo
      // agujero que `list()` ya había cerrado tres métodos más arriba.
      referralCodes: { some: { whiteLabelId: alcance.wlId } },
    };
    if (teamId) {
      // Excluir users que YA están en este equipo.
      const existing = await this.prisma.salesTeamMember.findMany({
        where: { teamId },
        select: { userId: true },
      });
      where.id = { notIn: existing.map((m) => m.userId) };
    }
    // SIN EL FILTRO AUTOMÁTICO DE NEGOCIO.
    //
    // `User` tiene `tenantId`, así que el middleware le inyecta el negocio (o
    // la lista de negocios de la marca) a toda consulta. Y **un afiliado no
    // pertenece a ningún negocio**: su `tenantId` es null, así que no entraba
    // en ninguna lista y esto devolvía CERO — en todas las marcas, incluida
    // Clubify con sus dos equipos. Se podía crear un equipo y no meter a
    // nadie; el panel enseñaba el desplegable vacío sin decir por qué.
    //
    // El aislamiento NO se pierde: se hace arriba, a mano y explícito, con
    // `referralCodes.some.whiteLabelId` sobre el alcance de `resolveBrandScope`
    // — que es más preciso que el del middleware, porque la marca de un
    // afiliado vive en su código de referido, no en un negocio.
    // OJO AL `async` Y AL `await`: no sobran.
    //
    // Lo que devuelve `findMany` es una PrismaPromise PEREZOSA: no ejecuta la
    // consulta —ni el middleware— hasta que alguien la espera. Crearla dentro
    // del contexto y esperarla FUERA deja el bypass sin efecto, y el resultado
    // es idéntico a no haber puesto nada. Pasó exactamente eso: el arreglo se
    // desplegó y la lista seguía saliendo vacía.
    return TenantContext.runWithoutTenant(async () => {
      // El `await` va AQUÍ DENTRO, y es lo único que hace que esto funcione.
      const filas = await this.prisma.user.findMany({
        where,
        select: { id: true, fullName: true, email: true, role: true },
        orderBy: { fullName: 'asc' },
      });
      return filas;
    });
  }
}
