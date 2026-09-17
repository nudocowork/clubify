/**
 * ¿Hay Sentry en este build? Lo pregunta `next.config.js` antes de envolver
 * la configuración con `withSentryConfig`.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * `withSentryConfig` mete `sentry.client.config.ts` en el paquete de TODAS las
 * páginas. Ese archivo solo llama a `Sentry.init` si hay DSN, pero la
 * referencia a `replayIntegration` está escrita igual, así que el SDK y Replay
 * viajaban al navegador aunque no fueran a hacer nada. Medido en producción el
 * 2026-09-17: el build no tenía DSN (`NEXT_PUBLIC_SENTRY_DSN` sin sustituir en
 * `main-app-*.js`) y cada página cargaba el trozo de Replay (119 KB).
 *
 * Sin DSN no se envuelve y no viaja nada. Con DSN —del navegador o del
 * servidor— todo sigue exactamente como estaba.
 *
 * CommonJS y no `.mjs`: lo carga `next.config.js` con `require`, y la versión
 * de Node del build no tiene por qué saber cargar un módulo ES desde ahí.
 *
 *   node scripts/pruebas-sentry-sin-dsn.mjs
 */

/** Un DSN de Sentry es una URL (`https://<clave>@<host>/<proyecto>`). */
function pareceDsn(valor) {
  return typeof valor === 'string' && /^https?:\/\/\S+$/i.test(valor.trim());
}

/**
 * `true` si el entorno del build trae un DSN de Sentry para el navegador
 * (`NEXT_PUBLIC_SENTRY_DSN`) o para el servidor (`SENTRY_DSN`).
 *
 * Solo `SENTRY_AUTH_TOKEN`/`SENTRY_ORG` no cuentan: sirven para subir
 * sourcemaps, no mandan ningún error a ningún sitio.
 *
 * @param {Record<string, string | undefined> | undefined} env
 * @returns {boolean}
 */
function sentryActivo(env) {
  const e = env || {};
  return pareceDsn(e.NEXT_PUBLIC_SENTRY_DSN) || pareceDsn(e.SENTRY_DSN);
}

module.exports = { sentryActivo };
