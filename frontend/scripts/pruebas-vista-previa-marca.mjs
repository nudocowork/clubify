#!/usr/bin/env node
/**
 * Pruebas de la VISTA PREVIA de las páginas públicas de un negocio: lo que
 * pinta WhatsApp al compartir el enlace.
 *
 *   node scripts/pruebas-vista-previa-marca.mjs
 *
 * El defecto, medido en producción antes de tocar nada:
 *   curl -s https://app.selleala.com/d/empanadas-la-parada | grep og:url
 *   → <meta property="og:url" content="https://soyclubify.com/d/empanadas-la-parada"/>
 *   → <link rel="canonical" href="https://soyclubify.com/d/empanadas-la-parada"/>
 * Y un negocio sin logo ni portada llevaba de `og:image` la tarjeta verde de
 * Clubify (`/og-image.png`). En `/w`, además, el favicon y el color de Clubify.
 *
 * La prueba que importa no es «el enlace es el correcto», sino «en la vista
 * previa de un negocio de otra marca NO aparece Clubify».
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  baseDeLaVistaPrevia,
  colorDelTema,
  esHostDeLaPlataforma,
  hostLimpio,
  iconosDelPase,
  imagenDeLaVistaPrevia,
} from '../src/lib/vista-previa-del-negocio.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (ruta) =>
  // CRLF (Windows + OneDrive) normalizado, o las anclas no casan nunca y esto
  // daría un rojo falso.
  readFileSync(resolve(AQUI, '..', ruta), 'utf8').replace(/\r\n/g, '\n');

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

const SELLEA_WEB = 'https://www.selleala.com';
const CLUBIFY_WEB = 'https://soyclubify.com';

// ══════════════════════════════════════════════════════════════════════════
// 1. EL CASO DEL ARQUEO
// ══════════════════════════════════════════════════════════════════════════
prueba('un negocio de Sellea abierto en app.selleala.com NO se anuncia con Clubify', () => {
  const base = baseDeLaVistaPrevia({ host: 'app.selleala.com', websiteUrl: SELLEA_WEB });
  igual(base, 'https://app.selleala.com', 'la base es el dominio que se comparte');
  afirmar(!/clubify/i.test(base), `se coló Clubify: ${base}`);
});

prueba('el mismo negocio abierto desde un dominio de Clubify cae a la web de SU marca', () => {
  for (const host of ['soyclubify.com', 'app.soyclubify.com', 'empanadas.soyclubify.com']) {
    igual(baseDeLaVistaPrevia({ host, websiteUrl: SELLEA_WEB }), SELLEA_WEB, `desde ${host}`);
  }
});

prueba('un negocio con dominio propio se anuncia con SU dominio', () => {
  igual(
    baseDeLaVistaPrevia({ host: 'birrialeon.com', websiteUrl: CLUBIFY_WEB }),
    'https://birrialeon.com',
    'dominio propio',
  );
});

prueba('un negocio de Clubify sigue saliendo como hasta ahora', () => {
  igual(
    baseDeLaVistaPrevia({ host: 'app.soyclubify.com', websiteUrl: CLUBIFY_WEB }),
    CLUBIFY_WEB,
    'Clubify en Clubify',
  );
});

prueba('sin web de marca y desde la plataforma: NO se inventa base', () => {
  igual(baseDeLaVistaPrevia({ host: 'soyclubify.com', websiteUrl: null }), null, 'sin web');
  igual(baseDeLaVistaPrevia({ host: 'soyclubify.com', websiteUrl: '' }), null, 'web vacía');
  igual(baseDeLaVistaPrevia({ host: '', websiteUrl: undefined }), null, 'sin nada');
  igual(baseDeLaVistaPrevia(), null, 'sin argumentos');
});

prueba('los despliegues de vista previa y desarrollo no cuentan como marca', () => {
  for (const host of ['clubify-git-rama-equipo.vercel.app', 'localhost:4848', '127.0.0.1:3000']) {
    igual(esHostDeLaPlataforma(host), true, `${host} es de la plataforma`);
    igual(baseDeLaVistaPrevia({ host, websiteUrl: SELLEA_WEB }), SELLEA_WEB, `desde ${host}`);
  }
  igual(esHostDeLaPlataforma('app.selleala.com'), false, 'Sellea no es la plataforma');
  // Un dominio que solo CONTIENE el nombre no es de la plataforma.
  igual(esHostDeLaPlataforma('soyclubify.com.estafa.co'), false, 'sufijo falso');
});

prueba('el host de la cabecera se limpia antes de acabar en un <meta>', () => {
  igual(hostLimpio('App.Selleala.com:443'), 'app.selleala.com', 'mayúsculas y puerto');
  igual(hostLimpio('evil.com"><script>'), '', 'inyección');
  igual(hostLimpio('a..b.com'), '', 'puntos dobles');
  igual(hostLimpio(null), '', 'nulo');
  igual(
    baseDeLaVistaPrevia({ host: 'x.com/<script>', websiteUrl: SELLEA_WEB }),
    SELLEA_WEB,
    'un host basura no se usa',
  );
});

prueba('una web de marca que no es http(s) no vale como base', () => {
  igual(baseDeLaVistaPrevia({ host: '', websiteUrl: 'javascript:alert(1)' }), null, 'javascript:');
  igual(baseDeLaVistaPrevia({ host: '', websiteUrl: 'www.selleala.com' }), null, 'sin protocolo');
  igual(
    baseDeLaVistaPrevia({ host: '', websiteUrl: 'https://www.selleala.com/inicio/' }),
    SELLEA_WEB,
    'se queda con el origen',
  );
});

// ══════════════════════════════════════════════════════════════════════════
// 2. IMAGEN, COLOR E ICONOS: sin datos del negocio, nada
// ══════════════════════════════════════════════════════════════════════════
prueba('sin portada ni logo NO hay og:image (antes: la tarjeta verde de Clubify)', () => {
  igual(imagenDeLaVistaPrevia(null, null), null, 'nada');
  igual(imagenDeLaVistaPrevia('', '  '), null, 'vacías');
  // Relativa: se resolvería contra el dominio que sirve la página, y
  // `/og-image.png` es la tarjeta de Clubify en TODOS los dominios.
  igual(imagenDeLaVistaPrevia(null, '/og-image.png'), null, 'relativa');
  igual(imagenDeLaVistaPrevia('data:image/png;base64,iVBORw0KGgo='), null, 'base64');
});

prueba('la portada va antes que el logo', () => {
  const portada = 'https://pub-x.r2.dev/hero.jpg';
  const logo = 'https://pub-x.r2.dev/logo.jpg';
  igual(imagenDeLaVistaPrevia(portada, logo), portada, 'portada');
  igual(imagenDeLaVistaPrevia(null, logo), logo, 'logo');
});

prueba('sin color del negocio ni de la marca NO se pinta el verde de Clubify', () => {
  igual(colorDelTema(null, undefined, ''), null, 'nada');
  igual(colorDelTema('', '#FF4D3D'), '#FF4D3D', 'cae al de la marca');
  igual(colorDelTema('#F59E0B', '#FF4D3D'), '#F59E0B', 'manda el del negocio');
  igual(colorDelTema('"><script>'), null, 'basura');
});

prueba('el favicon de la tarjeta: negocio → marca → nada', () => {
  const marca = {
    faviconUrl: 'https://pub-x.r2.dev/branding/fav.png',
    iconUrl: 'https://pub-x.r2.dev/branding/icon.png',
    logoUrl: 'https://pub-x.r2.dev/branding/logo.png',
  };
  const logo = 'https://pub-x.r2.dev/logos/negocio.jpg';
  igual(iconosDelPase({ logoDelNegocio: logo, marca }), { icon: logo, apple: logo }, 'negocio');
  igual(
    iconosDelPase({ logoDelNegocio: null, marca }),
    { icon: marca.faviconUrl, apple: marca.faviconUrl },
    'marca',
  );
  igual(
    iconosDelPase({ logoDelNegocio: null, marca: { logoUrl: marca.logoUrl } }),
    { icon: marca.logoUrl, apple: marca.logoUrl },
    'logo de la marca',
  );
  igual(iconosDelPase({ logoDelNegocio: null, marca: null }), null, 'nada');
  igual(iconosDelPase(), null, 'sin argumentos');
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
// 3. QUE LOS LAYOUTS USEN LO PROBADO
// Sin esto, todo lo de arriba sigue verde mientras las páginas siguen
// escribiendo `soyclubify.com` a mano.
// ══════════════════════════════════════════════════════════════════════════
const IMPORT = "from '@/lib/vista-previa-del-negocio.mjs'";
const layouts = [
  [
    'src/app/d/[slug]/layout.tsx',
    [
      [IMPORT, true],
      ['baseDeLaVistaPrevia(', true],
      ['imagenDeLaVistaPrevia(', true],
      ['colorDelTema(', true],
      ['hostDeLaPeticion()', true],
      ['SITE_URL}/d/', false],
      ['og-image.png', false],
      ["'#22C55E'", false],
    ],
  ],
  [
    'src/app/m/[slug]/layout.tsx',
    [
      [IMPORT, true],
      ['baseDeLaVistaPrevia(', true],
      ['imagenDeLaVistaPrevia(', true],
      ['colorDelTema(', true],
      ['hostDeLaPeticion()', true],
      ['SITE_URL}/m/', false],
      // La versión anterior de /m ya miraba la web de la marca, pero caía a
      // `SITE_URL` (Clubify) cuando la marca no tenía web.
      ['|| SITE_URL', false],
      ['og-image.png', false],
      ["'#22C55E'", false],
    ],
  ],
  [
    'src/app/w/[passId]/layout.tsx',
    [
      [IMPORT, true],
      ['baseDeLaVistaPrevia(', true],
      ['iconosDelPase(', true],
      ['colorDelTema(', true],
      ['hostDeLaPeticion()', true],
      ['SITE_URL}/w/', false],
      ["'#22C55E'", false],
      // Los iconos estáticos de /public son los de Clubify.
      ['/favicon-32.png', false],
      ['/icons/icon.svg', false],
      ['/apple-touch-icon.png', false],
    ],
  ],
  [
    'src/app/o/[code]/layout.tsx',
    [
      [IMPORT, true],
      ['baseDeLaVistaPrevia(', true],
      ['hostDeLaPeticion()', true],
      ['SITE_URL}/o/', false],
    ],
  ],
];
// Lo que NO debe estar se busca en el código sin comentarios: el comentario que
// explica por qué se quitó `/og-image.png` no es volver a ponerlo. (Quitar `//`
// también recorta los `https://` de las cadenas; aquí no molesta, porque
// ninguna de esas anclas lleva `//`.)
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const [ruta, anclas] of layouts) {
  const texto = leer(ruta);
  const codigo = sinComentarios(texto);
  const mal = anclas
    .filter(([a, debeEstar]) => (debeEstar ? texto : codigo).includes(a) !== debeEstar)
    .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'sigue'}: ${a}`);
  if (mal.length) {
    fallos++;
    console.log(`\nFALLA  ${ruta} no usa la vista previa probada:\n       ${mal.join('\n       ')}`);
  } else {
    console.log(`\nok     ${ruta} usa la vista previa probada`);
  }
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos + ${layouts.length} layouts`);
process.exit(fallos === 0 ? 0 : 1);
