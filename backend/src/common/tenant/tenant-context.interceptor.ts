import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from './tenant-context';

/**
 * Interceptor global que envuelve cada request HTTP con el TenantContext del
 * usuario autenticado. Corre DESPUÉS del JwtAuthGuard (que popula req.user)
 * pero ANTES del handler.
 *
 * Si no hay req.user (endpoints @Public), corre con bypass = true para que
 * las queries públicas (storefront, orders públicas) funcionen sin filter.
 *
 * Modo marca blanca: si el usuario es SUPER_ADMIN y su JWT trae `whiteLabelId`
 * (entró a una white-label vía impersonateWhiteLabel), resolvemos el set de
 * tenants de esa marca y lo metemos en el contexto. El middleware Prisma lo
 * usa para scopear TODAS las queries de modelos con tenantId a esa marca
 * (no solo los dashboards). Sin marca activa → comportamiento global de
 * siempre.
 */

// Caché en memoria del set de tenantIds por marca blanca. TTL 60s: evita
// resolver el set en cada request de una sesión que "entró" a una marca, a
// costa de hasta 60s de desfase si se reasigna un tenant a otra marca.
const WL_CACHE_TTL_MS = 60_000;
const wlTenantCache = new Map<string, { ids: string[]; expires: number }>();

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveWhiteLabelTenantIds(
    whiteLabelId: string,
  ): Promise<string[]> {
    const now = Date.now();
    const cached = wlTenantCache.get(whiteLabelId);
    if (cached && cached.expires > now) return cached.ids;
    const rows = await this.prisma.tenant.findMany({
      where: { whiteLabelId },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    wlTenantCache.set(whiteLabelId, { ids, expires: now + WL_CACHE_TTL_MS });
    return ids;
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<{
      user?: {
        id: string;
        role: any;
        tenantId: string | null;
        whiteLabelId?: string | null;
      };
    }>();
    const user = req.user;

    if (!user) {
      return TenantContext.run(
        { tenantId: null, userId: null, role: null, bypass: true },
        () => next.handle(),
      );
    }

    // Modo marca blanca: resolvemos el set de tenants de la marca activa para
    // que el middleware scopee las queries a esos tenantIds. Solo aplica a
    // SUPER_ADMIN con whiteLabelId (impersonación de white-label).
    let whiteLabelId: string | null = null;
    let whiteLabelTenantIds: string[] | null = null;
    if (user.role === 'SUPER_ADMIN' && user.whiteLabelId) {
      whiteLabelId = user.whiteLabelId;
      whiteLabelTenantIds = await this.resolveWhiteLabelTenantIds(
        user.whiteLabelId,
      );
    }

    // AsyncLocalStorage.run propaga el contexto a TODAS las promesas que se
    // creen dentro de next.handle() (Observable handler de Nest).
    return TenantContext.run(
      {
        tenantId: user.tenantId ?? null,
        userId: user.id,
        role: user.role,
        bypass: false,
        whiteLabelId,
        whiteLabelTenantIds,
      },
      () => next.handle(),
    );
  }
}
