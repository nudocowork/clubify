#!/usr/bin/env node
/**
 * Que nadie vuelva a permitir un DOMINIO COMPARTIDO en `remotePatterns`.
 *
 * `next/image` solo optimiza imágenes de los hosts de esa lista. El problema es
 * que un comodín sobre un dominio que no es nuestro permite a TODO el que tenga
 * algo ahí. Así estaba:
 *
 *     { protocol: 'https', hostname: '**.r2.dev' }
 *
 * y todo bucket público de Cloudflare R2 del mundo es un `pub-<hash>.r2.dev`.
 * Cualquiera con un bucket podía hacer que nuestro optimizador le sirviera sus
 * imágenes desde app.soyclubify.com: nuestro ancho de banda, nuestro dominio
 * para alojar lo que quisiera, y la API de imágenes de Next arrastra un DoS
 * conocido (GHSA-h64f-5h5j-jqjh, sin parche en la rama 14).
 *
 * Un comodín sobre un dominio NUESTRO (`**.soyclubify.com`) no es lo mismo:
 * ahí los subdominios los damos nosotros. Por eso la lista de abajo es de
 * dominios de terceros, no una prohibición de comodines a secas.
 *
 *   node scripts/arqueo-imagenes-remotas.cjs        # mirar
 *   node scripts/arqueo-imagenes-remotas.cjs --ci   # falla si hay alguno
 */
const path = require('path');

// Dominios de terceros donde el subdominio lo elige cualquiera. Un comodín
// sobre uno de estos es una puerta abierta, no una lista de permitidos.
const COMPARTIDOS = [
  'r2.dev',
  'r2.cloudflarestorage.com',
  'supabase.co',
  'amazonaws.com',
  's3.amazonaws.com',
  'blob.core.windows.net',
  'storage.googleapis.com',
  'cloudfront.net',
  'githubusercontent.com',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'ngrok.io',
  'ngrok-free.app',
  'herokuapp.com',
  'firebasestorage.app',
  'appspot.com',
];

const ci = process.argv.includes('--ci');

let config;
try {
  config = require(path.join(process.cwd(), 'next.config.js'));
} catch (e) {
  console.error('\nNo se pudo leer next.config.js: ' + e.message + '\n');
  process.exit(1);
}

const patrones = (config.default ?? config).images?.remotePatterns ?? [];

// Si el arqueo no ve nada, no puede decir que todo esté bien: eso es justo el
// fallo que hace que un candado dé verde sin mirar.
if (patrones.length === 0) {
  console.error(
    '\nEl arqueo no está viendo `images.remotePatterns` en next.config.js.\n' +
      'Puede que el config haya cambiado de forma (¿lo envuelve un plugin que\n' +
      'no devuelve `images`?). Sin leerlo no se puede afirmar nada.\n',
  );
  process.exit(1);
}

const malos = [];
for (const p of patrones) {
  const host = String(p.hostname ?? '');
  if (!host.includes('*')) continue;
  // `**.algo.com` permite cualquier subdominio: el riesgo es de quién es `algo.com`.
  const base = host.replace(/^\*+\./, '').replace(/\*/g, '');
  const compartido = COMPARTIDOS.find((d) => base === d || base.endsWith('.' + d));
  if (compartido) malos.push({ host, compartido });
}

console.log('\nHosts que next/image puede optimizar (' + patrones.length + '):');
for (const p of patrones) {
  const host = String(p.hostname ?? '');
  const marca = malos.some((m) => m.host === host) ? '  <-- DOMINIO COMPARTIDO' : '';
  console.log('  ' + (p.protocol ?? 'https') + '://' + host + (p.pathname ? p.pathname : '') + marca);
}

if (malos.length === 0) {
  console.log('\nNinguno es un comodín sobre un dominio de terceros.\n');
  process.exit(0);
}

console.error('\n=== next/image ACEPTA IMÁGENES DE CUALQUIERA ===\n');
for (const m of malos) {
  console.error('  ' + m.host + '  ->  el subdominio de `' + m.compartido + '` lo elige cualquiera');
}
console.error(
  '\nPon el host EXACTO del bucket o del CDN. Si de verdad hacen falta varios,\n' +
    'enumérales uno a uno: una lista de permitidos que acepta cualquier cosa no\n' +
    'es una lista de permitidos.\n',
);
process.exit(ci ? 1 : 0);
