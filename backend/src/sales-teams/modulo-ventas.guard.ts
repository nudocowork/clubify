import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';
import { moduloEncendido } from './team-access';

/**
 * Equipos de Ventas no existe para una marca que no tiene el módulo.
 *
 * POR QUÉ HACE FALTA, SI YA ESTABA `resolveTeamAccess`
 * ---------------------------------------------------
 * Las rutas por equipo (`sales-teams/:teamId/...`) ya pasaban por
 * `resolveTeamAccess`, que comprueba el módulo. Pero **`admin/sales-teams` no
 * pasa por ahí**: `list`, `create`, `leaderboard` y `eligible-users` solo
 * aislaban por marca. Resultado: un admin de una marca SIN el módulo podía
 * pedir la lista y —lo serio— **crear un equipo** escribiendo la URL a mano.
 * Esconderlo del menú no es cerrarlo.
 *
 * Reportado por Javier el 2026-09-10 sobre el panel de Sellea: «no debería ser
 * ocultarlos, deberían no aparecer de ninguna manera».
 *
 * **404 y no 403**, igual que `resolveTeamAccess`: un 403 confirma que la
 * función existe y que a esa marca le falta el permiso. El 404 no dice nada.
 *
 * NO se pone en las rutas `@Public()` de la agenda (`public/agenda/...`): esas
 * las abre el cliente final, no llevan sesión, y ya comprueban el módulo por
 * su cuenta en `sales-agenda.service.ts`.
 */
@Injectable()
export class ModuloVentasGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    // Sin sesión no decidimos aquí: de eso ya se ocupa el guard de auth, que
    // corre antes. Devolver true no abre nada.
    if (!user) return true;

    // La marca sale de la SESIÓN. `resolveBrandScope` es la regla de siempre:
    // sin marca en sesión se cae a Clubify, nunca a «todas».
    const { wlId } = await resolveBrandScope(this.prisma, user.whiteLabelId);
    if (!(await moduloEncendido(this.prisma, wlId))) {
      throw new NotFoundException('No encontrado');
    }
    return true;
  }
}
