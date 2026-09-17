import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { resolveBrandScope } from '../common/white-label/brand-scope.util';

/**
 * Contabilidad es de la PLATAFORMA, no de las marcas.
 *
 * `@Roles('SUPER_ADMIN')` no bastaba: un administrador de marca blanca ES un
 * SUPER_ADMIN con `whiteLabelId`, y el `RolesGuard` solo mira el rol. En la
 * interfaz la sección está escondida para las marcas (`clubifyOnly`), pero la
 * API respondía: un admin de Sellea con su sesión podía leer los ingresos de
 * Clubify y, desde el 2026-09-17, borrar colaboradores y pagos de nómina por id
 * (revisión de Fable).
 *
 * Entran la sesión sin marca y la sesión DENTRO de Clubify (así trabaja el
 * operador al entrar a Clubify desde /superadmin), con el mismo criterio que
 * `resolveBrandScope` usa en el resto del panel.
 */
@Injectable()
export class SoloPlataformaGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx.switchToHttp().getRequest()?.user as
      | { whiteLabelId?: string | null }
      | undefined;
    if (!user?.whiteLabelId) return true;
    const scope = await resolveBrandScope(this.prisma, user.whiteLabelId);
    if (scope.isClubify) return true;
    throw new ForbiddenException('La contabilidad es de la plataforma.');
  }
}
