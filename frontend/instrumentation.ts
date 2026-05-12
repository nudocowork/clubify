/**
 * Hook de Next.js 13+ que carga la config de Sentry según el runtime.
 * Esto registra Sentry ANTES de que cualquier código de la app corra.
 *
 * Sin DSN seteada los archivos de config no inicializan nada — Sentry queda
 * inerte y el costo es solo el bundle de @sentry/nextjs (~30KB en server,
 * ya tree-shakeado en el cliente).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { onRequestError } from '@sentry/nextjs';
