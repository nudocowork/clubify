#!/usr/bin/env node
/**
 * Pruebas de la CARGA de imágenes del menú libro.
 *
 *   node scripts/pruebas-libro-imagenes.mjs
 *
 * Lo que se quería: que abrir la carta no se baje los originales del bucket.
 * Medido en producción antes de tocar nada: 16 negocios con el libro
 * encendido, 206 páginas, 111 MB de originales. La peor carta real es
 * degodoy-sas: 105 páginas y 48,5 MB, imágenes de 1.275 px pintadas en una
 * ranura de ~390 px de teléfono.
 *
 * Lo que estas pruebas cuidan tanto como eso: que no se rompa ninguna carta.
 * Un ancho que el optimizador no acepta responde 400 y la página se queda en
 * blanco (w=900 → 400, comprobado contra producción), y una URL que no se
 * puede optimizar tiene que seguir cargándose tal cual.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ANCHOS_DEL_LIBRO,
  CALIDAD_DEL_LIBRO,
  anchoPermitido,
  cargaDeLaPagina,
  desplazamientoDelSalto,
  hostOptimizable,
  srcSetDelLibro,
  urlOptimizada,
} from '../src/lib/menu/imagen-del-libro.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VISOR = resolve(AQUI, '../src/components/menu/MenuBookViewer.tsx');
const CONFIG = resolve(AQUI, '../next.config.js');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
function afirmar(cond, detalle) {
  if (!cond) throw new Error(detalle);
}
const igual = (a, b, detalle) =>
  afirmar(
    JSON.stringify(a) === JSON.stringify(b),
    `${detalle} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`,
  );

// Una página real de la carta de degodoy-sas (1.275x1.650, ~1 MB en el bucket).
const PAGINA =
  'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/menu-book/GTqQHHAMIc3nw5IZ.jpeg';

// ══════════════════════════════════════════════════════════════════════════
// 1. LO QUE SE PEDÍA
// ══════════════════════════════════════════════════════════════════════════
prueba('la página se pide por el optimizador, no cruda al bucket', () => {
  const u = urlOptimizada(PAGINA, 828);
  afirmar(u.startsWith('/_next/image?'), `no pasa por el optimizador: ${u}`);
  afirmar(u.includes(`w=828`), 'falta el ancho');
  afirmar(u.includes(`q=${CALIDAD_DEL_LIBRO}`), 'falta la calidad');
  afirmar(u.includes(encodeURIComponent(PAGINA)), 'la URL original va sin codificar');
});

prueba('la URL es RELATIVA — una marca blanca no puede servir soyclubify.com', () => {
  const u = urlOptimizada(PAGINA, 640);
  afirmar(u.startsWith('/'), `URL absoluta: ${u}`);
  afirmar(!/soyclubify|https?:\/\/[^&]*\/_next/.test(u.split('?')[0]), 'host escrito a mano');
});

prueba('el srcset ofrece todos los anchos, del teléfono al escritorio', () => {
  const ss = srcSetDelLibro(PAGINA);
  for (const w of ANCHOS_DEL_LIBRO) {
    afirmar(ss.includes(` ${w}w`), `falta el descriptor ${w}w`);
  }
  igual(ss.split(', ').length, ANCHOS_DEL_LIBRO.length, 'número de candidatos');
});

prueba('la página que se está viendo NO es perezosa, y va primero', () => {
  igual(cargaDeLaPagina(0, 0), { loading: 'eager', fetchPriority: 'high' }, 'la activa');
});

prueba('la siguiente se precarga sin competir con la que se ve', () => {
  igual(cargaDeLaPagina(1, 0), { loading: 'eager', fetchPriority: 'low' }, 'la siguiente');
});

prueba('las demás esperan su turno', () => {
  igual(cargaDeLaPagina(7, 0), { loading: 'lazy', fetchPriority: 'auto' }, 'una lejana');
  igual(cargaDeLaPagina(104, 0), { loading: 'lazy', fetchPriority: 'auto' }, 'la última');
});

prueba('saltar de sección NO arrastra la ventana por el libro entero', () => {
  // Con desplazamiento suave, las 103 páginas de en medio asoman y disparan
  // su imagen: tocar un chip se bajaba la carta completa.
  igual(desplazamientoDelSalto(0, 104), 'instant', 'salto largo');
  igual(desplazamientoDelSalto(104, 0), 'instant', 'salto largo hacia atrás');
  igual(desplazamientoDelSalto(0, 2), 'instant', 'dos páginas ya es salto');
});

prueba("'auto' NO vale como «no animar» — es la trampa de esta API", () => {
  // Según la spec, `behavior:'auto'` significa «usa el scroll-behavior
  // computado del elemento», y el scroller lleva la clase `scroll-smooth`.
  // O sea que 'auto' ahí anima, que es justo lo contrario de lo que parece.
  // Esta prueba existió una versión entera exigiendo 'auto' y daba VERDE
  // mientras el bug seguía vivo.
  for (const [a, b] of [[0, 104], [104, 0], [0, 2]]) {
    const r = desplazamientoDelSalto(a, b);
    afirmar(r !== 'auto', `${a}->${b} devolvió 'auto', que el CSS convierte en suave`);
    afirmar(r === 'instant', `${a}->${b} tiene que ser 'instant', fue '${r}'`);
  }
});

prueba('pasar de una en una se sigue animando (es lo que parece un libro)', () => {
  igual(desplazamientoDelSalto(0, 1), 'smooth', 'siguiente');
  igual(desplazamientoDelSalto(5, 4), 'smooth', 'anterior');
  igual(desplazamientoDelSalto(3, 3), 'smooth', 'la misma');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE NO PUEDE CAMBIAR — aquí es donde se rompen las cartas
// ══════════════════════════════════════════════════════════════════════════
prueba('nunca se pide un ancho que el optimizador rechaza', () => {
  // w=900 responde 400 en producción y la página sale en blanco.
  igual(anchoPermitido(900), 828, '900 cae al permitido más cercano');
  igual(anchoPermitido(1_000_000), 3840, 'por arriba');
  igual(anchoPermitido(1), 640, 'por abajo');
  igual(anchoPermitido('nada'), 640, 'basura');
  for (const w of ANCHOS_DEL_LIBRO) {
    igual(anchoPermitido(w), w, `${w} ya es válido`);
  }
});

prueba('una imagen incrustada en base64 se deja EXACTAMENTE como está', () => {
  const b64 = 'data:image/png;base64,iVBORw0KGgo=';
  igual(urlOptimizada(b64, 640), b64, 'no se toca');
  igual(srcSetDelLibro(b64), null, 'sin srcset');
});

prueba('una URL ya optimizada no se envuelve dos veces', () => {
  const ya = '/_next/image?url=algo&w=640&q=85';
  igual(urlOptimizada(ya, 828), ya, 'se deja igual');
  igual(srcSetDelLibro(ya), null, 'sin srcset');
});

prueba('un host que el optimizador rechazaría se sirve CRUDO, no en blanco', () => {
  // Un 400 dentro del srcset no degrada: deja la página sin imagen, porque el
  // navegador no cae al `src` cuando la candidata falla. Mejor pesada que
  // invisible.
  const ajeno = 'https://cdn-nuevo-sin-configurar.com/menu-book/x.jpg';
  igual(hostOptimizable(ajeno), false, 'host fuera de remotePatterns');
  igual(urlOptimizada(ajeno, 828), ajeno, 'se sirve tal cual');
  igual(srcSetDelLibro(ajeno), null, 'sin srcset');
});

prueba('los hosts que SÍ están configurados se optimizan', () => {
  for (const u of [
    'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/menu-book/x.webp',
    'https://cdn.soyclubify.com/menu-book/x.webp',
    'https://ugbqfcogmqkuhhepecfq.supabase.co/storage/v1/object/public/x.jpg',
    '/imagenes/local.png',
  ]) {
    igual(hostOptimizable(u), true, `debería optimizarse: ${u}`);
  }
  igual(hostOptimizable('no-es-una-url'), false, 'basura');
});

prueba('la lista de hosts no se ha separado de next.config.js', () => {
  // Si alguien añade un CDN a next.config.js y no aquí, las cartas de ese CDN
  // se servirían crudas para siempre sin que nadie se entere.
  const cfg = readFileSync(CONFIG, 'utf8').replace(/\r\n/g, '\n');
  const hosts = [...cfg.matchAll(/hostname:\s*'([^']+)'/g)].map((m) => m[1]);
  afirmar(hosts.length > 0, 'no pude leer remotePatterns de next.config.js');
  for (const h of hosts) {
    // `**.r2.dev` en next.config equivale a un subdominio cualquiera.
    const ejemplo = h.replace(/^\*\*\./, 'algo.').replace(/^\*\./, 'algo.');
    igual(hostOptimizable(`https://${ejemplo}/x.jpg`), true, `configurado pero no optimizable: ${h}`);
  }
});

prueba('los anchos por defecto de Next siguen siendo los que damos por buenos', () => {
  // ANCHOS_PERMITIDOS son los `deviceSizes` POR DEFECTO. Si alguien los
  // redefine en next.config.js, nuestra lista deja de ser cierta y podemos
  // pedir un ancho que responda 400.
  const cfg = readFileSync(CONFIG, 'utf8').replace(/\r\n/g, '\n');
  afirmar(!/deviceSizes/.test(cfg), 'next.config.js ya define deviceSizes: revisa ANCHOS_PERMITIDOS');
  afirmar(!/imageSizes/.test(cfg), 'next.config.js ya define imageSizes: revisa ANCHOS_PERMITIDOS');
  afirmar(!/unoptimized/.test(cfg), 'next.config.js desactiva el optimizador: esto no ahorra nada');
});

prueba('sin URL no se inventa nada', () => {
  igual(urlOptimizada('', 640), '', 'vacía');
  igual(urlOptimizada(null, 640), '', 'nula');
  igual(srcSetDelLibro(''), null, 'sin srcset');
  igual(srcSetDelLibro(undefined), null, 'sin srcset');
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

// CRLF (Windows + OneDrive) normalizado antes de comparar, o las anclas no
// casan nunca y esto daría un rojo falso.
const visor = readFileSync(VISOR, 'utf8').replace(/\r\n/g, '\n');
const anclas = [
  ["from '@/lib/menu/imagen-del-libro.mjs'", true],
  // Que la página salga por el optimizador y con el srcset puesto: sin
  // estas dos, todo lo de arriba sigue verde y el cliente se baja los
  // originales igual que antes.
  ['urlOptimizada(page.imageUrl', true],
  ['srcSetDelLibro(page.imageUrl)', true],
  ['TAMANOS_DEL_LIBRO', true],
  ['cargaDeLaPagina(', true],
  ['desplazamientoDelSalto(', true],
  // La precarga vieja se bajaba la URL ORIGINAL del bucket. Si vuelve, el
  // ahorro se anula entero y todo lo de arriba seguiría en verde.
  ['new window.Image()', false],
  // NINGÚN scrollTo del visor puede usar 'auto': el scroller lleva
  // `scroll-smooth`, así que 'auto' anima. Cubre los dos sitios — el salto de
  // sección y el del enlace directo a una sección.
  ["behavior: 'auto'", false],
];
const mal = anclas
  .filter(([a, debeEstar]) => visor.includes(a) !== debeEstar)
  .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'volvió'}: ${a}`);
if (mal.length) {
  fallos++;
  console.log(`\nFALLA  el visor ya no usa lo que se prueba aquí:\n       ${mal.join('\n       ')}`);
} else {
  console.log('\nok     el visor usa la carga probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
