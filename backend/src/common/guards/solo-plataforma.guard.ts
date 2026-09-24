import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBrandScope } from '../white-label/brand-scope.util';

/**
 * Lo que es de la PLATAFORMA no lo toca una marca blanca.
 *
 * `@Roles('SUPER_ADMIN')` no basta, y este es el punto ciego más repetido del
 * backend: un administrador de marca blanca ES un SUPER_ADMIN con
 * `whiteLabelId`, y el `RolesGuard` solo compara `user.role`. Cualquier ruta
 * marcada solo con ese rol es alcanzable por el admin de Sellea o de cualquier
 * otra marca.
 *
 * Se descubrió en Contabilidad: en la interfaz la sección está escondida para
 * las marcas (`clubifyOnly`), pero la API respondía — un admin de Sellea leía
 * los ingresos de Clubify y, desde el 2026-09-17, borraba colaboradores y pagos
 * de nómina por id. Entonces el guard se aplicó SOLO a los cuatro controladores
 * de finanzas, y la auditoría del 2026-09-24 encontró el mismo agujero abierto
 * en mantenimiento (apagar la plataforma entera), cortes de comisiones,
 * suplantación de afiliados, branding, plantillas de SMS, cotizaciones, pagos
 * pendientes, base de conocimiento y leads de las landings.
 *
 * Por eso vive aquí y no en `finance/`: es general.
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
    throw new ForbiddenException('Esta sección es de la plataforma, no de las marcas.');
  }
}
