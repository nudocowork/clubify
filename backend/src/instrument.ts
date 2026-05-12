/**
 * Inicialización de Sentry. DEBE importarse como PRIMERA línea de main.ts
 * para que la auto-instrumentación de @sentry/node enganche `http`, `pg`,
 * `express`, etc. antes de que NestJS los cargue.
 *
 * Sin `SENTRY_DSN` configurada, Sentry no envía nada — la instrumentación
 * queda silenciosa, no rompe el boot. Esto es A propósito: dev local sigue
 * andando sin pedir cuenta Sentry, y los entornos sin DSN no fallan.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    // Tracing: muestreamos 10% en prod, 100% en dev para que se vean spans
    // mientras desarrollamos. Bajar a 0.05 si el volumen sube.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // No mandamos cookies / headers de auth por default. Si querés full
    // PII para debugging, ponelo en env: SENTRY_SEND_PII=true.
    sendDefaultPii: process.env.SENTRY_SEND_PII === 'true',
    // Filtra ruido típico que no aporta valor.
    ignoreErrors: [
      // Tenant suspended (lo manejamos como 402, no es bug)
      'TENANT_SUSPENDED',
      // Errors de validación del cliente — son user error, no incidentes.
      'BadRequestException',
      'UnauthorizedException',
      'ForbiddenException',
      'NotFoundException',
    ],
    beforeSend(event) {
      // Scrubbing: nunca mandar campos sensibles aunque sendDefaultPii esté on.
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      return event;
    },
  });
}

export { Sentry };
