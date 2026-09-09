import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
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
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      leadUser: t.leadUser,
      memberCount: t._count.members,
      createdAt: t.createdAt,
    }));
  }

  /**
   * El equipo, comprobando que sea DE TU MARCA.
   *
   * Antes no recibía el usuario y no miraba la marca: un super admin de Sellea
   * podía leer, editar y borrar un equipo de Clubify con solo saber su id. Los
   * métodos de escritura llamaban a este `get` creyendo que validaba, y solo
   * validaba que existiera.
   */
  async get(id: string, user?: AuthUser) {
    if (user) await this.exigirMiMarca(id, user);
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
    return this.prisma.salesTeam.update({
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
  }

  async remove(id: string, user: AuthUser) {
    await this.exigirMiMarca(id, user);
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
    const where: any = {
      role: {
        in: ['AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO'],
      },
      isActive: true,
      // Aislamiento por marca: solo afiliados de la marca activa.
      ...(user.whiteLabelId
        ? { referralCodes: { some: { whiteLabelId: user.whiteLabelId } } }
        : {}),
    };
    if (teamId) {
      // Excluir users que YA están en este equipo.
      const existing = await this.prisma.salesTeamMember.findMany({
        where: { teamId },
        select: { userId: true },
      });
      where.id = { notIn: existing.map((m) => m.userId) };
    }
    return this.prisma.user.findMany({
      where,
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }
}
