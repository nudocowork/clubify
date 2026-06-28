import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';

/**
 * Global guard que aplica el modo mantenimiento.
 *
 * Cuando `maintenance.enabled = true` devolvemos 503 a TODOS los requests
 * EXCEPTO:
 *  - SUPER_ADMIN (para que pueda desactivar el flag desde el admin)
 *  - Allowlist de paths que SIEMPRE deben funcionar:
 *      /api/health                       → healthcheck Railway
 *      /api/auth/login, /api/auth/me     → SUPER_ADMIN se loguea para apagar
 *      /api/admin/maintenance/*          → toggle del flag
 *      /api/public/maintenance/status    → frontend lee estado sin auth
 *  - Métodos OPTIONS/HEAD (CORS preflight + checks de health)
 *
 * Se ejecuta DESPUÉS del JwtAuthGuard + RolesGuard, así `req.user` ya está
 * poblado y podemos hacer el bypass por rol. Si el JWT no era válido,
 * JwtAuthGuard ya tiró 401 antes y este guard ni se ejecuta para esa ruta.
 *
 * 503 incluye Retry-After (segundos hasta `maintenance.until` si está
 * configurado, sino 300 = 5min). El frontend Next middleware lo usa para
 * decidir cuándo re-chequear el flag.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private maintenance: MaintenanceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    const method = (req.method as string) || 'GET';
    if (method === 'OPTIONS' || method === 'HEAD') return true;

    const path = (req.path as string) || '';

    // Allowlist — paths que SIEMPRE deben funcionar incluso en mantenimiento.
    if (
      path === '/api/health' ||
      path.startsWith('/api/admin/maintenance') ||
      path.startsWith('/api/public/maintenance') ||
      path === '/api/auth/login' ||
      path === '/api/auth/refresh' ||
      path === '/api/auth/me'
    ) {
      return true;
    }

    const status = await this.maintenance.getStatus();
    if (!status.enabled) return true;

    // SUPER_ADMIN / PLATFORM_OWNER bypass — para que puedan seguir trabajando
    // durante la ventana de mantenimiento (apagar el flag, hacer changes, etc).
    // 2026-06-28: incluido PLATFORM_OWNER (master admin, está por encima de
    // SUPER_ADMIN y es quien CORRE el mantenimiento) — antes en su sesión de
    // Modo plataforma quedaba bloqueado y no podía operar /admin durante la
    // ventana (ej. crear administradores).
    const user = req.user;
    if (user?.role === 'SUPER_ADMIN' || user?.role === 'PLATFORM_OWNER') {
      return true;
    }

    // Calcular Retry-After: segundos hasta `until` si está, sino 300.
    let retryAfter = 300;
    if (status.until) {
      const target = new Date(status.until).getTime();
      if (Number.isFinite(target)) {
        const diff = Math.ceil((target - Date.now()) / 1000);
        if (diff > 0) retryAfter = Math.min(diff, 3600);
      }
    }
    if (res && typeof res.header === 'function') {
      res.header('Retry-After', String(retryAfter));
    }

    throw new HttpException(
      {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'MAINTENANCE_MODE',
        message:
          status.message ||
          'Estamos actualizando el sistema. Volvemos en unos minutos.',
        until: status.until,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
