import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { normalizarRoles, resolveTeamAccess, type AccesoAlEquipo } from './team-access';
import { SalesTeamsService } from './sales-teams.service';

/**
 * «Colaboradores» del equipo: quién lo ve y con qué rol.
 *
 * La gestión de miembros ya existía, pero colgada de `admin/sales-teams`: solo
 * un admin de la marca y desde el listado de equipos. En TeamClubify es una
 * pestaña del equipo y el LÍDER también gestiona a su gente. Esto la trae.
 *
 * Las reglas de alta, roles y baja siguen siendo las de `SalesTeamsService` —
 * aquí no hay una segunda copia—. Lo que se añade es la puerta por equipo y dos
 * límites para el líder: no reparte ni quita el rol de líder (eso es de un admin
 * de la marca) y no se quita a sí mismo.
 */
@Injectable()
export class ColaboradoresDeEquipoService {
  constructor(
    private prisma: PrismaService,
    private equipos: SalesTeamsService,
  ) {}

  private puedeGestionar(acceso: AccesoAlEquipo): boolean {
    return acceso.esAdminDeMarca || acceso.roles.includes('lider');
  }

  /**
   * La sesión, vista con la marca DEL EQUIPO.
   *
   * `SalesTeamsService` resuelve la marca con `user.whiteLabelId`, y ese campo
   * solo lo lleva un admin de marca: para un líder que no es admin es null y
   * cae en Clubify. Los candidatos salían de OTRA marca, con nombre y correo, y
   * agregar, cambiar o quitar daba 404 (Fable, 2026-09-14). La marca del equipo
   * ya la validó `resolveTeamAccess`.
   */
  private comoMarcaDelEquipo(user: AuthUser, acceso: AccesoAlEquipo): AuthUser {
    return { ...user, whiteLabelId: acceso.team.whiteLabelId } as AuthUser;
  }

  private exigirGestionar(acceso: AccesoAlEquipo) {
    if (!this.puedeGestionar(acceso)) {
      throw new ForbiddenException(
        'Solo el líder del equipo o un admin de la marca pueden cambiar los colaboradores',
      );
    }
  }

  async listar(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    const [equipo, miembros] = await Promise.all([
      // `SalesTeam` y `SalesTeamMember` no tienen `tenantId`, y el `select`
      // anidado de `User` tampoco pasa por el filtro de negocio: en el panel de
      // una marca los nombres salen (comprobado en la revisión del Banco).
      this.prisma.salesTeam.findUnique({
        where: { id: teamId },
        select: { leadUser: { select: { id: true, fullName: true, email: true } } },
      }),
      this.prisma.salesTeamMember.findMany({
        where: { teamId },
        orderBy: { joinedAt: 'asc' },
        select: {
          userId: true,
          roles: true,
          isActive: true,
          joinedAt: true,
          user: { select: { fullName: true, email: true } },
        },
      }),
    ]);

    return {
      team: acceso.team,
      puedeEscribir: acceso.puedeEscribir,
      puedeGestionar: this.puedeGestionar(acceso),
      esAdminDeMarca: acceso.esAdminDeMarca,
      yo: user.id,
      lider: equipo?.leadUser
        ? { id: equipo.leadUser.id, nombre: equipo.leadUser.fullName, email: equipo.leadUser.email }
        : null,
      miembros: miembros.map((m) => ({
        userId: m.userId,
        nombre: m.user?.fullName ?? 'Sin nombre',
        email: m.user?.email ?? null,
        roles: normalizarRoles(m.roles),
        activo: m.isActive,
        desde: m.joinedAt,
      })),
    };
  }

  /** Quién se puede agregar: los mismos candidatos que ve el admin, con sus otros equipos. */
  async candidatos(user: AuthUser, teamId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirGestionar(acceso);
    const usuarios = await this.equipos.listEligibleUsers(this.comoMarcaDelEquipo(user, acceso), teamId);
    if (!usuarios.length) return { candidatos: [] };

    // «Ya está en…»: solo los equipos de la MISMA marca. De otra marca no se dice nada.
    const otros = await this.prisma.salesTeamMember.findMany({
      where: {
        userId: { in: usuarios.map((u) => u.id) },
        isActive: true,
        teamId: { not: teamId },
        team: { whiteLabelId: acceso.team.whiteLabelId },
      },
      select: { userId: true, team: { select: { name: true } } },
    });
    const equiposDe = new Map<string, string[]>();
    for (const o of otros) equiposDe.set(o.userId, [...(equiposDe.get(o.userId) ?? []), o.team.name]);

    return {
      candidatos: usuarios.map((u) => ({
        id: u.id,
        nombre: u.fullName || u.email,
        email: u.email,
        otrosEquipos: equiposDe.get(u.id) ?? [],
      })),
    };
  }

  async agregar(user: AuthUser, teamId: string, body: { userId?: string; roles?: string[] }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirGestionar(acceso);
    if (!body.userId) throw new BadRequestException('Elige a quién agregar');
    const roles = normalizarRoles(body.roles);
    if (!acceso.esAdminDeMarca && roles.includes('lider')) {
      throw new ForbiddenException('Solo un admin de la marca puede dar el rol de líder');
    }
    // Solo quien sale entre los candidatos. La regla de quién puede entrar (los
    // afiliados de la marca) vive en `listEligibleUsers`; aceptar cualquier id
    // metería en el equipo a cualquiera con conocer el suyo.
    const comoMarca = this.comoMarcaDelEquipo(user, acceso);
    const elegibles = await this.equipos.listEligibleUsers(comoMarca, teamId);
    if (!elegibles.some((u) => u.id === body.userId)) {
      throw new BadRequestException('Esa persona no se puede agregar a este equipo');
    }
    await this.equipos.addMember(teamId, comoMarca, body.userId, roles);
    return { ok: true };
  }

  async cambiarRoles(user: AuthUser, teamId: string, userId: string, body: { roles?: string[] }) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirGestionar(acceso);
    const actual = await this.miembro(teamId, userId);
    const antes = normalizarRoles(actual.roles);
    const despues = normalizarRoles(body.roles);
    if (!acceso.esAdminDeMarca && antes.includes('lider') !== despues.includes('lider')) {
      throw new ForbiddenException('Solo un admin de la marca puede dar o quitar el rol de líder');
    }
    await this.equipos.setMemberRoles(teamId, this.comoMarcaDelEquipo(user, acceso), userId, despues);
    return { ok: true };
  }

  async quitar(user: AuthUser, teamId: string, userId: string) {
    const acceso = await resolveTeamAccess(this.prisma, user, teamId);
    this.exigirGestionar(acceso);
    if (!acceso.esAdminDeMarca && userId === user.id) {
      throw new BadRequestException('No puedes quitarte a ti mismo del equipo');
    }
    const actual = await this.miembro(teamId, userId);
    if (!acceso.esAdminDeMarca && normalizarRoles(actual.roles).includes('lider')) {
      throw new ForbiddenException('Solo un admin de la marca puede quitar a un líder');
    }
    await this.equipos.removeMember(teamId, this.comoMarcaDelEquipo(user, acceso), userId);
    return { ok: true };
  }

  private async miembro(teamId: string, userId: string) {
    const m = await this.prisma.salesTeamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { roles: true },
    });
    if (!m) throw new NotFoundException('Esa persona no está en el equipo');
    return m;
  }
}
