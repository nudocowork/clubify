import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Filter global que captura cualquier exception NO manejada y la manda a
 * Sentry antes de delegar al BaseExceptionFilter (que se encarga de la
 * respuesta HTTP).
 *
 * Skipea exceptions HTTP 4xx — esas son user errors, no incidentes.
 * 5xx + cualquier non-HTTP exception sí se reporta.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Solo reportar errores realmente "inesperados".
    const shouldReport = this.shouldReportToSentry(exception);

    if (shouldReport) {
      // Enriquecer con contexto del request si está disponible.
      if (host.getType() === 'http') {
        const req = host.switchToHttp().getRequest<{
          user?: { id: string; email: string; role: string; tenantId: string | null };
          path?: string;
          method?: string;
        }>();
        Sentry.withScope((scope) => {
          if (req.user) {
            scope.setUser({
              id: req.user.id,
              email: req.user.email,
              // Tags útiles para filtrar en el dashboard.
            });
            scope.setTag('role', req.user.role);
            if (req.user.tenantId) scope.setTag('tenantId', req.user.tenantId);
          }
          if (req.path) scope.setTag('path', req.path);
          if (req.method) scope.setTag('method', req.method);
          Sentry.captureException(exception);
        });
      } else {
        Sentry.captureException(exception);
      }
    }

    super.catch(exception, host);
  }

  private shouldReportToSentry(exception: unknown): boolean {
    if (!(exception instanceof HttpException)) return true; // unhandled
    const status = exception.getStatus();
    // 5xx: bug del servidor. Reportar siempre.
    if (status >= 500) return true;
    // 4xx: user error (auth, validation, not found). No reportar.
    return false;
  }
}
