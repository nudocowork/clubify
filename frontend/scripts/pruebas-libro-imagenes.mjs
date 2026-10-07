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
  ANCHO_DE_MINIATURA,
  ANCHOS_DEL_LIBRO,
  CALIDAD_DE_MINIATURA,
  CALIDAD_DEL_LIBRO,
  MARGEN_DE_LA_TIRA,
  REINTENTOS_DE_HOJA,
  anchoDeHoja,
  anchoPermitido,
  cargaDeLaPagina,
  desplazamientoDeLaTira,
  desplazamientoDelSalto,
  hojasVecinas,
  hojasVisibles,
  hostOptimizable,
  srcSetDelLibro,
  urlDeHoja,
  urlDeMiniatura,
  urlOptimizada,
} from '../src/lib/menu/imagen-del-libro.mjs';
import { ANCHOS_DE_ICONO } from '../src/lib/imagen-optimizada.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VISOR = resolve(AQUI, '../src/components/menu/MenuBookViewer.tsx');
const LIBRO = resolve(AQUI, '../src/components/menu/LibroDeHojas.tsx');
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

prueba('y tampoco al revés: optimizable pero no configurado sale EN BLANCO', () => {
  // La dirección que faltaba, y es la peligrosa. La de arriba pilla «un CDN
  // nuevo se sirve crudo», que es feo pero funciona. Esta pilla lo contrario:
  // si PATRONES_OPTIMIZABLES acepta un host que next.config.js no tiene, la
  // URL se envuelve en /_next/image, Next la rechaza y la imagen no sale.
  // No sale fea: NO SALE.
  //
  // Pasó el 2026-09-28 al acotar remotePatterns a hosts exactos: el config se
  // quedó con los exactos y esta lista mantuvo el comodín de r2.dev. La de
  // arriba pasaba igual, porque solo mira en un sentido.
  const cfg = readFileSync(CONFIG, 'utf8');
  const configurados = [...cfg.matchAll(/hostname:\s*'([^']+)'/g)].map((m) => m[1]);

  const espejo = readFileSync(
    new URL('../src/lib/imagen-optimizada.mjs', import.meta.url),
    'utf8',
  );
  // De una expresión como /^cdn\.soyclubify\.com$/i sale cdn.soyclubify.com.
  const optimizables = [...espejo.matchAll(/host:\s*\/\^?([^$\/]+)\$?\//g)].map((m) =>
    m[1].split('\\.').join('.'),
  );
  afirmar(optimizables.length > 0, 'no pude leer PATRONES_OPTIMIZABLES');

  const sinComodin = (h) => h.replace(/^\*+\.?/, '');
  for (const h of optimizables) {
    const base = sinComodin(h);
    const casa = configurados.some((c) => {
      const cb = sinComodin(c);
      return c === h || cb === base || base.endsWith('.' + cb) || cb.endsWith('.' + base);
    });
    afirmar(
      casa,
      `optimizable pero NO está en next.config.js: ${h} — sus imágenes saldrían en blanco`,
    );
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
// 3. EL MODO LIBRO (LibroDeHojas) — medido el 2026-10-07 en De Godoy
// ══════════════════════════════════════════════════════════════════════════
prueba('la miniatura pide 128 px, no una página entera de 640', () => {
  // w=160 pasaba por `anchoPermitido`, que nunca baja de 640: cada cuadrito
  // de 31×40 se bajaba 62 KB (mediana). A 128 son 2-5 KB.
  const u = urlDeMiniatura(PAGINA);
  afirmar(u.startsWith('/_next/image?'), `no pasa por el optimizador: ${u}`);
  afirmar(u.includes(`w=${ANCHO_DE_MINIATURA}&`), `ancho equivocado: ${u}`);
  afirmar(u.includes(`q=${CALIDAD_DE_MINIATURA}`), `calidad equivocada: ${u}`);
  afirmar(ANCHO_DE_MINIATURA >= 80 && ANCHO_DE_MINIATURA <= 160, 'fuera de 80-160');
});

prueba('el ancho de la miniatura es uno que el optimizador acepta', () => {
  // `imageSizes` por defecto de Next. Fuera de la lista: 400 y en blanco.
  afirmar(ANCHOS_DE_ICONO.includes(ANCHO_DE_MINIATURA), `${ANCHO_DE_MINIATURA} no está en imageSizes`);
});

prueba('la miniatura de algo no optimizable se sirve cruda, no en blanco', () => {
  const ajeno = 'https://cdn-nuevo-sin-configurar.com/menu-book/x.jpg';
  igual(urlDeMiniatura(ajeno), ajeno, 'cruda');
  igual(urlDeMiniatura(''), '', 'vacía');
});

prueba('urlOptimizada sigue sin bajar de 640 (la miniatura va por su cuenta)', () => {
  afirmar(urlOptimizada(PAGINA, 160).includes('w=640'), 'el suelo de 640 cambió');
});

prueba('la hoja en un teléfono retina pide lo que la pantalla pinta, no 1920', () => {
  // 380 puntos × DPR 2,625 = 998 px → 1080. Antes: sizes=760px × 2,625 → 1920.
  igual(anchoDeHoja(380, 2.625), 1080, 'teléfono');
  igual(anchoDeHoja(412, 3), 1200, 'teléfono DPR 3');
});

prueba('en una pantalla 1× se sigue pidiendo el DOBLE (la letra no se lava)', () => {
  // Lo que pidió Javier el día del estreno: a 1× la letra pequeña se veía lavada.
  igual(anchoDeHoja(472, 1), 1080, 'escritorio, hoja de 472');
  igual(anchoDeHoja(602, 1), 1200, '602×2=1204 acepta 1200, no salta a 1920');
  igual(anchoDeHoja(900, 1), 1920, 'hoja muy grande');
});

prueba('el ancho de la hoja es siempre uno del libro (nunca un 400)', () => {
  for (const css of [0, -5, 'x', 50, 180, 300, 380, 472, 602, 800, 1200, 5000]) {
    for (const dpr of [undefined, 0, 1, 1.5, 2, 2.625, 3, 4]) {
      const w = anchoDeHoja(css, dpr);
      afirmar(ANCHOS_DEL_LIBRO.includes(w), `anchoDeHoja(${css}, ${dpr}) = ${w}`);
    }
  }
  const u = urlDeHoja(PAGINA, 380, 2.625);
  afirmar(u.includes('w=1080') && u.includes(`q=${CALIDAD_DEL_LIBRO}`), `hoja: ${u}`);
});

prueba('la calidad de la hoja NO baja: una carta es texto', () => {
  igual(CALIDAD_DEL_LIBRO, 85, 'calidad del libro');
});

prueba('en retrato se ve UNA hoja', () => {
  igual(hojasVisibles(0, 105, false), [0], 'portada');
  igual(hojasVisibles(40, 105, false), [40], 'en medio');
  igual(hojasVisibles(999, 105, false), [104], 'fuera de rango');
});

prueba('a doble página: la portada sola y luego pliegos [impar, par]', () => {
  igual(hojasVisibles(0, 105, true), [0], 'portada');
  igual(hojasVisibles(1, 105, true), [1, 2], 'primer pliego');
  igual(hojasVisibles(2, 105, true), [1, 2], 'la derecha lleva a su pliego');
  igual(hojasVisibles(80, 105, true), [79, 80], 'miniatura 81');
  igual(hojasVisibles(104, 105, true), [103, 104], 'el último');
  igual(hojasVisibles(3, 4, true), [3], 'último pliego incompleto');
  igual(hojasVisibles(0, 0, true), [], 'libro vacío');
});

prueba('las vecinas son solo el pliego de antes y el de después', () => {
  // Antes: ±3 desde el primer momento, a la vez que la visible.
  igual(hojasVecinas(0, 105, false), [1, 2], 'portada en retrato');
  igual(hojasVecinas(40, 105, false), [41, 42, 39], 'en medio, retrato');
  igual(hojasVecinas(104, 105, false), [103], 'la última');
  igual(hojasVecinas(0, 105, true), [1, 2], 'portada a doble página');
  igual(hojasVecinas(5, 105, true), [7, 8, 4, 3], 'pliego [5,6]');
  for (const [i, d] of [[0, false], [40, true], [104, true]]) {
    const vis = hojasVisibles(i, 105, d);
    const vec = hojasVecinas(i, 105, d);
    afirmar(vec.every((k) => !vis.includes(k)), `repite visibles en ${i}`);
    afirmar(vec.length <= 4, `demasiadas vecinas en ${i}: ${vec}`);
  }
});

prueba('una hoja que falla se reintenta, y no para siempre', () => {
  afirmar(REINTENTOS_DE_HOJA.length >= 2 && REINTENTOS_DE_HOJA.length <= 5, 'reintentos');
  afirmar(REINTENTOS_DE_HOJA.every((ms, i, a) => i === 0 || ms > a[i - 1]), 'cada espera más larga');
});

prueba('la tira no se arrastra por todas las miniaturas en un salto largo', () => {
  igual(desplazamientoDeLaTira(0, 80), 'instant', 'salto');
  igual(desplazamientoDeLaTira(80, 0), 'instant', 'salto atrás');
  igual(desplazamientoDeLaTira(4, 5), 'smooth', 'siguiente');
  igual(desplazamientoDeLaTira(5, 3), 'smooth', 'pliego anterior');
  afirmar(MARGEN_DE_LA_TIRA > 0 && MARGEN_DE_LA_TIRA <= 400, 'margen razonable');
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

// Lo mismo para el modo libro, que es el predeterminado: sin estas anclas,
// las funciones de arriba pueden estar verdes y el libro seguir pidiendo las
// 105 hojas y 105 miniaturas de 640 como antes.
const libro = readFileSync(LIBRO, 'utf8').replace(/\r\n/g, '\n');
const anclasLibro = [
  ['urlDeMiniatura(p.imageUrl)', true],
  ['urlDeMiniatura(pages[0].imageUrl)', true],
  ['urlDeHoja(p.imageUrl', true],
  ['hojasVisibles(', true],
  ['hojasVecinas(', true],
  ['root: tira', true],
  ['REINTENTOS_DE_HOJA', true],
  // La miniatura por `urlOptimizada` vuelve al suelo de 640.
  ['urlOptimizada(p.imageUrl', false],
  // `sizes` al doble del pintado: el navegador multiplicaba además por DPR.
  ['img.sizes = ', false],
  ['img.srcset = ', false],
  // `loading="lazy"` en la tira: no frena nada dentro de un scroller horizontal.
  ['loading="lazy"', false],
];
const malLibro = anclasLibro
  .filter(([a, debeEstar]) => libro.includes(a) !== debeEstar)
  .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'volvió'}: ${a}`);
if (malLibro.length) {
  fallos++;
  console.log(`\nFALLA  el libro ya no usa la carga probada aquí:\n       ${malLibro.join('\n       ')}`);
} else {
  console.log('ok     el libro usa la carga probada aquí');
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos`);
process.exit(fallos === 0 ? 0 : 1);
