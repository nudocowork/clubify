import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { personalizadoPuede } from '../permisos-de-equipo';

/** Cuánto se recuerdan los permisos de un miembro personalizado. */
const CACHE_PERMISOS_MS = 30_000;

@Injectable()
export class RolesGuard implements CanActivate {
  private permisosEnCache = new Map<string, { permisos: string[]; hasta: number }>();

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Si el endpoint está marcado @Public(), saltea check de roles
    // (ej: media proxy de imágenes públicas, sin sesión)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const { user } = ctx.switchToHttp().getRequest();

    // Rol personalizado: decide la sección de la ruta, no la lista de roles
    // (ver `permisos-de-equipo.ts`). Va antes del «sin @Roles = abierto» para
    // que una ruta de sección sin @Roles (p. ej. /metrics) también se cierre.
    if (user?.role === 'TENANT_CUSTOM') {
      const ruta = this.rutaDelControlador(ctx);
      if (!personalizadoPuede(ruta, required, await this.permisosDe(user.id))) {
        throw new ForbiddenException('No tienes acceso a esta sección');
      }
      return true;
    }

    if (!required || required.length === 0) return true;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }

  /**
   * La ruta tal como la declara el código (`catalog/products/:id`), no la URL
   * pedida: así el prefijo de la sección no depende de ids ni de mayúsculas.
   */
  private rutaDelControlador(ctx: ExecutionContext): string {
    const parte = (x: unknown) => {
      const v = Array.isArray(x) ? x[0] : x;
      return typeof v === 'string' ? v.replace(/^\/+|\/+$/g, '') : '';
    };
    return [
      parte(Reflect.getMetadata(PATH_METADATA, ctx.getClass())),
      parte(Reflect.getMetadata(PATH_METADATA, ctx.getHandler())),
    ]
      .filter(Boolean)
      .join('/');
  }

  /**
   * De la base y no del token: si el dueño le quita una sección, deja de verla
   * en ≤30 s, no cuando caduque su sesión.
   */
  private async permisosDe(userId: string): Promise<string[]> {
    const ahora = Date.now();
    const guardado = this.permisosEnCache.get(userId);
    if (guardado && guardado.hasta > ahora) return guardado.permisos;
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { permisos: true, isActive: true },
    });
    const permisos = u?.isActive ? (u.permisos ?? []) : [];
    this.permisosEnCache.set(userId, { permisos, hasta: ahora + CACHE_PERMISOS_MS });
    return permisos;
  }
}
