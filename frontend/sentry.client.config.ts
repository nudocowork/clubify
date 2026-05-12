/**
 * Sentry runtime configuration para el cliente (browser).
 * Si NEXT_PUBLIC_SENTRY_DSN no está seteada, Sentry no se inicializa y
 * el bundle sigue limpio.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV,
    // 5% de transacciones para perf. Subir si querés más data, bajar si
    // el plan free se quema rápido.
    tracesSampleRate: 0.05,
    // Replay para reproducir bugs visuales. 0% siempre, 100% en errores.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        // No grabamos texto ni media — solo estructura DOM. Cero PII.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    // No reportamos errores típicos de extensions de Chrome / browser noise.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      // Errores de fetch que son normales cuando el user cierra el tab.
      'AbortError',
    ],
  });
}
