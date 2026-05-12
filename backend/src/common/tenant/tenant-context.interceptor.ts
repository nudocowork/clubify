import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context';

/**
 * Interceptor global que envuelve cada request HTTP con el TenantContext del
 * usuario autenticado. Corre DESPUÉS del JwtAuthGuard (que popula req.user)
 * pero ANTES del handler.
 *
 * Si no hay req.user (endpoints @Public), corre con bypass = true para que
 * las queries públicas (storefront, orders públicas) funcionen sin filter.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<{
      user?: { id: string; role: any; tenantId: string | null };
    }>();
    const user = req.user;

    const ctx = user
      ? {
          tenantId: user.tenantId ?? null,
          userId: user.id,
          role: user.role,
          bypass: false,
        }
      : { tenantId: null, userId: null, role: null, bypass: true };

    // AsyncLocalStorage.run propaga el contexto a TODAS las promesas que se
    // creen dentro de next.handle() (Observable handler de Nest).
    return TenantContext.run(ctx, () => next.handle());
  }
}
