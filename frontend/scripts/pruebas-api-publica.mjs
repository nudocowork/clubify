#!/usr/bin/env node
/**
 * Pruebas de las direcciones de los GET públicos cacheables (menú, negocio,
 * menú libro y tarjeta de registro).
 *
 *   node scripts/pruebas-api-publica.mjs
 *
 * Lo que se quería: que el navegador los pida por la ruta relativa `/api/...`
 * y no directo a `api.soyclubify.com`, para que pasen por la caché del borde
 * de Vercel (`s-maxage` del backend). Comprobado antes de tocar nada:
 *   curl -sI https://api.soyclubify.com/api/public/m/<slug>/menu   → sin caché, ~1,4 s siempre
 *   curl -sI https://app.selleala.com/api/public/m/<slug>/menu     → x-vercel-cache: HIT, ~0,36 s
 *
 * Lo que estas pruebas cuidan tanto como eso:
 *   - que la URL no cambie de forma (es la clave de la caché y el backend
 *     espera esos parámetros),
 *   - que los POST sigan yendo directos a la API,
 *   - que exista la reescritura `/api/:path*` de next.config.js: sin ella, la
 *     ruta relativa da 404 y la carta sale vacía.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  urlDeLaTarjeta,
  urlDelLibro,
  urlDelMenu,
  urlDelNegocio,
} from '../src/lib/api-publica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
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

// ══════════════════════════════════════════════════════════════════════════
// 1. LO QUE SE PEDÍA
// ══════════════════════════════════════════════════════════════════════════
prueba('todas son RELATIVAS: entran por el dominio de la página, no por la API', () => {
  for (const u of [
    urlDelNegocio('konys', { locale: 'es' }),
    urlDelMenu('konys', { locale: 'es', mode: 'mesa' }),
    urlDelLibro('konys'),
    urlDeLaTarjeta('abc', { locale: 'es' }),
  ]) {
    afirmar(u.startsWith('/api/'), `no es relativa: ${u}`);
    afirmar(!u.includes('://'), `lleva host: ${u}`);
    afirmar(!/soyclubify/i.test(u), `lleva el dominio de Clubify: ${u}`);
  }
});

prueba('el negocio se pide igual que antes', () => {
  igual(urlDelNegocio('konys', { locale: 'es' }), '/api/public/m/konys?locale=es', 'con idioma');
  igual(
    urlDelNegocio('empanadas-la-parada', { locale: 'en', oficina: 'abc-123' }),
    '/api/public/m/empanadas-la-parada?locale=en&oficina=abc-123',
    'con oficina',
  );
  // El menú libro lo pide SIN idioma: es otra entrada de caché y no se toca.
  igual(urlDelNegocio('konys'), '/api/public/m/konys', 'sin idioma');
});

prueba('la carta se pide igual que antes, y la sede manda sobre la oficina', () => {
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'mesa' }),
    '/api/public/m/konys/menu?locale=es&mode=mesa',
    'sin sede',
  );
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'delivery', sede: 'sede-1' }),
    '/api/public/m/konys/menu?locale=es&mode=delivery&sede=sede-1',
    'con sede',
  );
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'delivery', oficina: 'carta-9' }),
    '/api/public/m/konys/menu?locale=es&mode=delivery&sede=carta-9',
    'la oficina va por sede',
  );
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'delivery', sede: 'sede-1', oficina: 'carta-9' }),
    '/api/public/m/konys/menu?locale=es&mode=delivery&sede=sede-1',
    'si llegan las dos, manda la sede',
  );
});

// La vista previa del panel recarga `/d/<slug>` cada vez que el dueño publica.
// Por la caché del borde (s-maxage 180 + stale-while-revalidate) vería el precio
// viejo hasta 3 minutos: «cambié el precio y no cambia». Con `fresco` la
// vista previa estrena su propia entrada; sin él, la de los clientes no cambia.
prueba('la vista previa del panel pide lo recién publicado, sin tocar la URL de los clientes', () => {
  igual(
    urlDelNegocio('konys', { locale: 'es', fresco: '1758090000000' }),
    '/api/public/m/konys?locale=es&fresco=1758090000000',
    'negocio fresco',
  );
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'delivery', sede: 'sede-1', fresco: '1758090000000' }),
    '/api/public/m/konys/menu?locale=es&mode=delivery&sede=sede-1&fresco=1758090000000',
    'carta fresca, al final para no mover el resto de la clave',
  );
  igual(urlDelMenu('konys', { locale: 'es', mode: 'mesa', fresco: '' }), '/api/public/m/konys/menu?locale=es&mode=mesa', 'vacío no cuenta');
  const cliente = readFileSync(new URL('../src/app/m/[slug]/storefront-client.tsx', import.meta.url), 'utf8');
  afirmar(/searchParams\?\.get\('fresco'\)/.test(cliente), 'el menú no lee ?fresco= de su URL');
  afirmar((cliente.match(/fresco:\s*frescoDelPanel/g) || []).length >= 2, 'el menú no pasa fresco a sus dos peticiones');
  const panel = readFileSync(new URL('../src/app/app/storefront/page.tsx', import.meta.url), 'utf8');
  afirmar(/src=\{`\$\{publicHref\}\?fresco=\$\{/.test(panel), 'la vista previa del panel no pide ?fresco=');
});

prueba('menú libro y tarjeta', () => {
  igual(urlDelLibro('degodoy-sas'), '/api/public/m/degodoy-sas/menu-book', 'libro');
  igual(
    urlDeLaTarjeta('3f2c', { locale: 'pt' }),
    '/api/passes/enroll/3f2c?locale=pt',
    'tarjeta',
  );
});

prueba('un valor raro no rompe la ruta ni se sale de ella', () => {
  igual(urlDelLibro('a/../../auth'), '/api/public/m/a%2F..%2F..%2Fauth/menu-book', 'barras');
  igual(
    urlDelMenu('konys', { locale: 'es', mode: 'mesa', sede: 'x&mode=delivery' }),
    '/api/public/m/konys/menu?locale=es&mode=mesa&sede=x%26mode%3Ddelivery',
    'un & en la sede no añade parámetros',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LA REESCRITURA DE LA QUE DEPENDE TODO
// ══════════════════════════════════════════════════════════════════════════
prueba('next.config.js reescribe /api/:path* hacia el backend', () => {
  const cfg = leer('next.config.js');
  afirmar(/source:\s*'\/api\/:path\*'/.test(cfg), 'falta la reescritura /api/:path*');
  afirmar(
    /destination:\s*`\$\{process\.env\.NEXT_PUBLIC_API_URL[^`]*\}\/api\/:path\*`/.test(cfg),
    'la reescritura ya no apunta a NEXT_PUBLIC_API_URL/api/:path*',
  );
});

prueba('ninguna ruta propia de Next tapa las de la API que pedimos', () => {
  // Las reescrituras de next.config.js se aplican DESPUÉS de las rutas del
  // propio Next: un `src/app/api/public/...` respondería él, no el backend.
  const raiz = resolve(AQUI, '../src/app/api');
  const rutas = readdirSync(raiz, { recursive: true })
    .map((r) => String(r).replace(/\\/g, '/'))
    .filter((r) => /(^|\/)route\.(t|j)sx?$/.test(r));
  afirmar(rutas.length > 0, 'no pude listar src/app/api');
  const tapan = rutas.filter((r) => r.startsWith('public/') || r.startsWith('passes/'));
  igual(tapan.join(', '), '', 'rutas de Next que taparían a la API');
});

// ══════════════════════════════════════════════════════════════════════════
// Ejecutar
// ══════════════════════════════════════════════════════════════════════════
for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`ok     ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FALLA  ${nombre}\n       ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. QUE LAS PÁGINAS USEN LO PROBADO
// ══════════════════════════════════════════════════════════════════════════
const IMPORT = "from '@/lib/api-publica.mjs'";
const paginas = [
  [
    'src/app/m/[slug]/storefront-client.tsx',
    [
      [IMPORT, true],
      ['urlDelNegocio(', true],
      ['urlDelMenu(', true],
      // Los GET del negocio y la carta ya no van directos a la API.
      ['${API}/api/public/m/', false],
      // El pedido es un POST: sigue yendo directo.
      ['${API}/api/public/orders', true],
    ],
  ],
  [
    'src/components/menu/MenuBookViewer.tsx',
    [
      [IMPORT, true],
      ['urlDelLibro(', true],
      ['${API}/api/public/m/', false],
    ],
  ],
  [
    'src/app/book/[slug]/book-client.tsx',
    [
      [IMPORT, true],
      ['urlDelNegocio(', true],
      ['${API}/api/public/m/', false],
    ],
  ],
  [
    'src/app/c/[cardId]/page.tsx',
    [
      [IMPORT, true],
      ['fetch(urlDeLaTarjeta(', true],
      // El POST del alta crea el pase: directo a la API, nunca por la caché.
      ['`${API}/api/passes/enroll/${cardId}?locale=${encodeURIComponent(locale)}`', true],
      ["method: 'POST'", true],
    ],
  ],
  [
    // El InfoLink cuenta visitas con su GET: no pasa por la caché.
    'src/app/i/[slug]/[linkSlug]/page.tsx',
    [[IMPORT, false]],
  ],
];
for (const [ruta, anclas] of paginas) {
  const texto = leer(ruta);
  const mal = anclas
    .filter(([a, debeEstar]) => texto.includes(a) !== debeEstar)
    .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'sigue'}: ${a}`);
  if (mal.length) {
    fallos++;
    console.log(`\nFALLA  ${ruta}:\n       ${mal.join('\n       ')}`);
  } else {
    console.log(`\nok     ${ruta}`);
  }
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos + ${paginas.length} páginas`);
process.exit(fallos === 0 ? 0 : 1);
