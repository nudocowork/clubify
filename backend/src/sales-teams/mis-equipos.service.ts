import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { moduloEncendido, normalizarRoles } from './team-access';

/**
 * «Mis equipos»: los equipos de ventas en los que esta persona es colaboradora.
 *
 * Es la puerta de entrada del panel del afiliado (`/affiliate/equipos`). Los
 * colaboradores de un equipo son afiliados y no entran al panel de admin; desde
 * aquí eligen su equipo y trabajan con las mismas pestañas.
 *
 * Solo equipos activos, con la membresía activa y de marcas con el módulo
 * encendido: sin el módulo, cada pestaña respondería 404 y la lista prometería
 * algo que no abre.
 */
@Injectable()
export class MisEquiposService {
  constructor(private prisma: PrismaService) {}

  async mios(user: AuthUser) {
    // `SalesTeamMember` y `SalesTeam` no tienen `tenantId`: el filtro de negocio
    // no los toca, y un afiliado —que no tiene negocio— los lee sin problema.
    const filas = await this.prisma.salesTeamMember.findMany({
      where: { userId: user.id, isActive: true, team: { isActive: true } },
      orderBy: { joinedAt: 'asc' },
      select: {
        roles: true,
        team: { select: { id: true, name: true, color: true, whiteLabelId: true } },
      },
    });

    const encendido = new Map<string, boolean>();
    const equipos: Array<{ id: string; nombre: string; color: string | null; roles: string[] }> = [];
    for (const f of filas) {
      const marca = f.team.whiteLabelId ?? '';
      if (!encendido.has(marca)) {
        encendido.set(marca, await moduloEncendido(this.prisma, f.team.whiteLabelId));
      }
      if (!encendido.get(marca)) continue;
      equipos.push({
        id: f.team.id,
        nombre: f.team.name,
        color: f.team.color,
        roles: normalizarRoles(f.roles),
      });
    }
    return { equipos };
  }
}
