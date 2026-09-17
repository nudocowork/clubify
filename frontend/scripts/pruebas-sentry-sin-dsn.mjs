#!/usr/bin/env node
/**
 * Pruebas de que Sentry NO se mete en el navegador cuando no hay DSN.
 *
 *   node scripts/pruebas-sentry-sin-dsn.mjs
 *
 * El defecto, medido en producción el 2026-09-17 descargando los scripts de
 * https://app.soyclubify.com/m/konys:
 *   - `main-app-*.js` trae compilado `sentry.client.config.ts`, con
 *     `r.env.NEXT_PUBLIC_SENTRY_DSN` SIN sustituir → la variable no existía en
 *     el build y `Sentry.init` no se llama nunca.
 *   - Aun así viajan el SDK y Replay (`52774a7f-*.js`, 119 KB; «Unable to send
 *     Replay», «sentryReplaySession») en TODAS las páginas: `withSentryConfig`
 *     inyecta ese archivo en el cliente, y la referencia a `replayIntegration`
 *     está escrita aunque el `if (dsn)` nunca se cumpla.
 *
 * El arreglo: sin DSN, `next.config.js` no envuelve con `withSentryConfig`.
 * Con DSN, todo queda exactamente como estaba.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const leer = (ruta) =>
  readFileSync(resolve(AQUI, '..', ruta), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}
const igual = (a, b, detalle) =>
  afirmar(a === b, `${detalle} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const DSN = 'https://abc123@o123456.ingest.us.sentry.io/7654321';

prueba('existe la regla y se puede cargar desde next.config.js (CommonJS)', () => {
  const m = require('../src/lib/sentry-activo.cjs');
  afirmar(typeof m.sentryActivo === 'function', 'no exporta sentryActivo');
});

prueba('sin DSN, Sentry no se activa', () => {
  const { sentryActivo } = require('../src/lib/sentry-activo.cjs');
  igual(sentryActivo({}), false, 'sin variables');
  igual(sentryActivo(undefined), false, 'sin entorno');
  igual(sentryActivo({ NEXT_PUBLIC_SENTRY_DSN: '' }), false, 'vacía');
  igual(sentryActivo({ NEXT_PUBLIC_SENTRY_DSN: '   ' }), false, 'espacios');
  // Pegada a mano desde otro sitio: la cadena literal no es un DSN.
  igual(sentryActivo({ NEXT_PUBLIC_SENTRY_DSN: 'undefined' }), false, '"undefined"');
  // Solo el token de subir sourcemaps no manda ningún error a ningún sitio.
  igual(sentryActivo({ SENTRY_AUTH_TOKEN: 'sntrys_x', SENTRY_ORG: 'o' }), false, 'solo token');
});

prueba('con DSN (del navegador o del servidor), Sentry sigue como estaba', () => {
  const { sentryActivo } = require('../src/lib/sentry-activo.cjs');
  igual(sentryActivo({ NEXT_PUBLIC_SENTRY_DSN: DSN }), true, 'DSN público');
  igual(sentryActivo({ SENTRY_DSN: DSN }), true, 'DSN del servidor');
  igual(sentryActivo({ NEXT_PUBLIC_SENTRY_DSN: ` ${DSN} ` }), true, 'con espacios');
});

prueba('next.config.js solo envuelve con withSentryConfig si hay DSN', () => {
  const cfg = leer('next.config.js');
  afirmar(cfg.includes("require('./src/lib/sentry-activo.cjs')"), 'no carga la regla');
  afirmar(
    /module\.exports\s*=\s*sentryActivo\(process\.env\)\s*\?\s*withSentryConfig\(/.test(cfg),
    'module.exports no depende de sentryActivo(process.env)',
  );
  // Que no quede otra llamada sin condición.
  igual((cfg.match(/withSentryConfig\(/g) || []).length, 1, 'llamadas a withSentryConfig');
});

prueba('la config del navegador sigue sin inicializar nada sin DSN', () => {
  const cli = leer('sentry.client.config.ts');
  afirmar(/if \(dsn\) \{/.test(cli), 'sentry.client.config.ts perdió el `if (dsn)`');
});

prueba('ningún archivo de la app importa @sentry directamente', () => {
  // Si alguno lo hace, el SDK vuelve al paquete del navegador por esa puerta,
  // con o sin withSentryConfig, y este arreglo deja de ahorrar nada.
  const raiz = resolve(AQUI, '../src');
  const archivos = readdirSync(raiz, { recursive: true })
    .map((r) => String(r).replace(/\\/g, '/'))
    .filter((r) => /\.(t|j)sx?$|\.mjs$/.test(r));
  afirmar(archivos.length > 100, 'no pude listar src');
  const conSentry = archivos.filter((r) =>
    /from ['"]@sentry\/|require\(['"]@sentry\//.test(readFileSync(resolve(raiz, r), 'utf8')),
  );
  igual(conSentry.join(', '), '', 'archivos que importan @sentry');
});

for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`ok     ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FALLA  ${nombre}\n       ${e.message.split('\n')[0]}`);
  }
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
