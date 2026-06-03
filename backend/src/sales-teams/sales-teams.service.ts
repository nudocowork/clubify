import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

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
  async list() {
    const teams = await this.prisma.salesTeam.findMany({
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

  async get(id: string) {
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

  async create(body: { name: string; leadUserId?: string | null }) {
    const name = (body.name ?? '').trim();
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    if (body.leadUserId) {
      const lead = await this.prisma.user.findUnique({
        where: { id: body.leadUserId },
        select: { id: true },
      });
      if (!lead) throw new BadRequestException('Lead user no existe');
    }
    return this.prisma.salesTeam.create({
      data: {
        name: name.slice(0, 80),
        leadUserId: body.leadUserId ?? null,
      },
      include: {
        leadUser: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  async update(id: string, body: { name?: string; leadUserId?: string | null }) {
    await this.get(id); // verifica existencia
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

  async remove(id: string) {
    await this.get(id);
    // Cascade en SalesTeamMember se encarga de los memberships.
    await this.prisma.salesTeam.delete({ where: { id } });
    return { ok: true };
  }

  async addMember(teamId: string, userId: string) {
    await this.get(teamId); // verifica que existe + 404 legible
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('User no existe');
    try {
      return await this.prisma.salesTeamMember.create({
        data: { teamId, userId },
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

  async removeMember(teamId: string, userId: string) {
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
  async listEligibleUsers(teamId?: string) {
    const where: any = {
      role: {
        in: ['AFFILIATE_INFLUENCER', 'AFFILIATE_AMBASSADOR', 'AFFILIATE_SOCIO'],
      },
      isActive: true,
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
