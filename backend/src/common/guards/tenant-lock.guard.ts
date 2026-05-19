import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Bloquea escrituras (POST/PATCH/PUT/DELETE) cuando el tenant está
 * marcado como `isLocked=true`. Lecturas (GET/HEAD/OPTIONS) siempre pasan,
 * para que el usuario navegue el panel como demo. SUPER_ADMIN nunca queda
 * bloqueado — puede editar el tenant locked para curar contenido demo.
 *
 * Whitelist mínima: /api/auth (login/logout) y /api/tenants/me (lectura).
 *
 * Devuelve 423 Locked con un mensaje claro + flag `code: TENANT_LOCKED`
 * para que el frontend pueda mostrar un toast amable.
 */
@Injectable()
export class TenantLockGuard implements CanActivate {
  // Cache para no pegarle a la DB en cada request — TTL corto porque el
  // toggle Lock/Unlock debe propagarse rápido.
  private cache = new Map<string, { locked: boolean; until: number }>();
  private TTL_MS = 15_000;

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

    const path = (req.path as string) || '';
    if (path.startsWith('/api/auth')) return true;

    const locked = await this.isLocked(user.tenantId);
    if (!locked) return true;

    // 423 Locked — Nest no expone HttpStatus.LOCKED en la enum de la
    // versión que usamos, usamos el código numérico directo.
    throw new HttpException(
      {
        statusCode: 423,
        message:
          'Esta cuenta está en modo demo de solo lectura. No se puede modificar contenido.',
        code: 'TENANT_LOCKED',
      },
      423,
    );
  }

  private async isLocked(tenantId: string): Promise<boolean> {
    const now = Date.now();
    const hit = this.cache.get(tenantId);
    if (hit && hit.until > now) return hit.locked;

    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { isLocked: true },
    });
    const locked = !!t?.isLocked;
    this.cache.set(tenantId, { locked, until: now + this.TTL_MS });
    return locked;
  }

  /** Invalida el cache de un tenant — llamar desde el endpoint Lock/Unlock
   *  para que el cambio se propague sin esperar al TTL. */
  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }
}
