import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Guarda escrituras (POST/PATCH/PUT/DELETE) cuando el tenant está SUSPENDED.
 * Permite siempre lecturas (GET) para que el dueño vea su info y se anime a
 * reactivar. SUPER_ADMIN nunca queda bloqueado. Endpoints @Public tampoco.
 *
 * Devuelve 402 Payment Required con un mensaje accionable.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  // Cache simple para no pegarle a la DB en cada request.
  private cache = new Map<string, { suspended: boolean; until: number }>();
  private TTL_MS = 30_000;

  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const method = (req.method as string) || 'GET';
    if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return true;

    const user = req.user;
    if (!user) return true; // pasa al JwtAuthGuard
    if (user.role === 'SUPER_ADMIN') return true;
    if (!user.tenantId) return true;

    // Whitelist de paths que siempre se permiten (para que pueda reactivar)
    const path = (req.path as string) || '';
    if (
      path.startsWith('/api/billing') ||
      path.startsWith('/api/auth') ||
      path === '/api/tenants/me'
    ) {
      return true;
    }

    const suspended = await this.isSuspended(user.tenantId);
    if (!suspended) return true;

    throw new HttpException(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        message:
          'Tu cuenta está suspendida. Reactiva la suscripción para volver a usar Clubify.',
        code: 'TENANT_SUSPENDED',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private async isSuspended(tenantId: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.until > now) return hit.suspended;

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, suspendedAt: true },
    });
    const suspended = !!t && (t.status === 'SUSPENDED' || !!t.suspendedAt);
    this.cache.set(tenantId, { suspended, until: now + this.TTL_MS });
    return suspended;
  }
}
