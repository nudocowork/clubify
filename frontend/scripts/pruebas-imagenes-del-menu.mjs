#!/usr/bin/env node
/**
 * Pruebas de las imágenes del menú digital que no son fotos de producto:
 * portadas de sección, logo del negocio y aviso emergente.
 *
 *   node scripts/pruebas-imagenes-del-menu.mjs
 *
 * Lo que se quería: que no se bajen las originales del bucket. Medido en
 * producción el 2026-09-17: las 15 portadas de Konys suman 5 MB; la mayor
 * (853 KB) sale por el optimizador en 151 KB a w=828.
 *
 * Lo que estas pruebas cuidan tanto como eso: que NINGUNA imagen desaparezca.
 * El optimizador responde 400 —y la imagen sale en blanco— a un ancho fuera
 * de lista, a un host fuera de `remotePatterns` (images.unsplash.com, que usan
 * portadas reales de nudocowork), a supabase fuera de su ruta pública y al
 * bucket por http. Todo eso comprobado contra producción antes de escribir
 * esto. Y que el logo no se encoja (ver IMAGEN_DEL_LOGO).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ANCHOS_PERMITIDOS,
  esOptimizable,
} from '../src/lib/imagen-optimizada.mjs';
import {
  IMAGEN_DEL_AVISO,
  IMAGEN_DEL_LOGO,
  IMAGEN_DE_PORTADA,
  ajusteDeLaPortada,
  imagenDelMenu,
  posicionDeLaPortada,
} from '../src/lib/menu/imagen-del-menu.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (ruta) =>
  // CRLF (Windows + OneDrive) normalizado, o las anclas no casan nunca.
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

// Imágenes reales de producción.
const PORTADA_KONYS =
  'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/2f275d54-b08d-4b72-a197-d9c61299990a/sections/eIhKf5iHJ-IC5COd.jpeg';
const LOGO_BIRRIA =
  'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/ab41ca77-70d3-4681-87b3-dba4ac7495d8/logos/9cmTKI0isUcFUew3.png';
const LOGO_SUPABASE =
  'https://ugbqfcogmqkuhhepecfq.supabase.co/storage/v1/object/public/clubify-uploads/v2-branding/17b1fb69-5c4a-4e34-9100-35946e2ea1a4-IMG_9424.jpg';
const PORTADA_UNSPLASH =
  'https://images.unsplash.com/photo-1437418747212-8d9709afab22?w=1200&q=80&auto=format&fit=crop';
const AVISO =
  'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/products/pEw1qHdSlhmB_ZdS.jpg';

const anchosDe = (srcSet) =>
  srcSet.split(', ').map((c) => Number(/ (\d+)w$/.exec(c)?.[1]));

// ══════════════════════════════════════════════════════════════════════════
// 1. LO QUE SE PEDÍA
// ══════════════════════════════════════════════════════════════════════════
prueba('la portada se pide por el optimizador, con srcset y sizes', () => {
  const p = imagenDelMenu(PORTADA_KONYS, IMAGEN_DE_PORTADA);
  afirmar(p.src.startsWith('/_next/image?'), `src crudo: ${p.src}`);
  afirmar(p.src.includes(encodeURIComponent(PORTADA_KONYS)), 'URL original sin codificar');
  afirmar(p.src.includes('&q=75'), 'calidad de portada');
  igual(anchosDe(p.srcSet), [640, 828, 1080, 1200], 'anchos del srcset');
  igual(p.sizes, IMAGEN_DE_PORTADA.tamanos, 'sizes');
});

prueba('las URL son RELATIVAS — una marca blanca no puede servir soyclubify.com', () => {
  for (const p of [
    imagenDelMenu(PORTADA_KONYS, IMAGEN_DE_PORTADA),
    imagenDelMenu(LOGO_BIRRIA, IMAGEN_DEL_LOGO),
    imagenDelMenu(AVISO, IMAGEN_DEL_AVISO),
  ]) {
    for (const u of [p.src, ...(p.srcSet ? p.srcSet.split(', ') : [])]) {
      afirmar(u.startsWith('/_next/image?'), `no es relativa: ${u}`);
    }
  }
});

prueba('el aviso lleva texto en la imagen: calidad 85 y srcset', () => {
  const p = imagenDelMenu(AVISO, IMAGEN_DEL_AVISO);
  afirmar(p.src.includes('&q=85'), 'calidad del aviso');
  igual(anchosDe(p.srcSet), [640, 828, 1080, 1200], 'anchos del aviso');
  igual(p.sizes, IMAGEN_DEL_AVISO.tamanos, 'sizes del aviso');
});

prueba('el logo va por el optimizador con UN solo ancho y SIN srcset', () => {
  // Con srcset de descriptores `w`, un logo original de 300 px se pintaría a
  // 300 / (640/260) = 122 px: el logo del negocio encogido a la mitad.
  const p = imagenDelMenu(LOGO_BIRRIA, IMAGEN_DEL_LOGO);
  igual(Object.keys(p), ['src'], 'solo src');
  afirmar(p.src.includes('&w=828&q=85'), `ancho/calidad del logo: ${p.src}`);
});

prueba('supabase (fotos del Onboarding) en su ruta pública sí se optimiza', () => {
  const p = imagenDelMenu(LOGO_SUPABASE, IMAGEN_DEL_LOGO);
  afirmar(p.src.startsWith('/_next/image?'), `debería optimizarse: ${p.src}`);
});

prueba('todos los anchos pedidos los acepta el optimizador', () => {
  for (const uso of [IMAGEN_DE_PORTADA, IMAGEN_DEL_AVISO]) {
    for (const w of uso.anchos) afirmar(ANCHOS_PERMITIDOS.includes(w), `ancho ${w} daría 400`);
  }
  afirmar(ANCHOS_PERMITIDOS.includes(IMAGEN_DEL_LOGO.ancho), 'ancho del logo daría 400');
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LO QUE NO PUEDE PASAR: una imagen que desaparece
// ══════════════════════════════════════════════════════════════════════════
prueba('un host fuera de remotePatterns se sirve CRUDO (unsplash: 400 en producción)', () => {
  igual(imagenDelMenu(PORTADA_UNSPLASH, IMAGEN_DE_PORTADA), { src: PORTADA_UNSPLASH }, 'unsplash');
});

prueba('supabase fuera de /storage/v1/object/public/ se sirve crudo (400 en producción)', () => {
  const firmada = 'https://ugbqfcogmqkuhhepecfq.supabase.co/storage/v1/object/sign/x.jpg?token=abc';
  igual(esOptimizable(firmada), false, 'ruta firmada');
  igual(imagenDelMenu(firmada, IMAGEN_DE_PORTADA), { src: firmada }, 'se sirve tal cual');
});

prueba('el bucket por http:// se sirve crudo (400 en producción)', () => {
  const http = PORTADA_KONYS.replace('https://', 'http://');
  igual(imagenDelMenu(http, IMAGEN_DE_PORTADA), { src: http }, 'http');
});

prueba('un SVG no pasa por el optimizador', () => {
  const svg = 'https://pub-x.r2.dev/logos/logo.SVG?v=2';
  igual(imagenDelMenu(svg, IMAGEN_DEL_LOGO), { src: svg }, 'svg');
});

prueba('base64, blob y URLs ya envueltas se dejan como están', () => {
  const b64 = 'data:image/png;base64,iVBORw0KGgo=';
  igual(imagenDelMenu(b64, IMAGEN_DE_PORTADA), { src: b64 }, 'base64');
  igual(imagenDelMenu('blob:https://x/1', IMAGEN_DE_PORTADA), { src: 'blob:https://x/1' }, 'blob');
  const ya = '/_next/image?url=x&w=640&q=75';
  igual(imagenDelMenu(ya, IMAGEN_DE_PORTADA), { src: ya }, 'ya envuelta');
  igual(esOptimizable('//pub-x.r2.dev/a.jpg'), false, 'sin protocolo no es del sitio');
});

prueba('sin URL no se inventa nada', () => {
  igual(imagenDelMenu('', IMAGEN_DE_PORTADA), { src: '' }, 'vacía');
  igual(imagenDelMenu(null, IMAGEN_DEL_LOGO), { src: '' }, 'nula');
});

prueba('la portada como <img> se ve igual que como fondo', () => {
  igual(ajusteDeLaPortada('cover'), 'cover', 'cover');
  igual(ajusteDeLaPortada('contain'), 'contain', 'contain');
  igual(ajusteDeLaPortada('auto'), 'none', 'tamaño natural');
  igual(ajusteDeLaPortada(undefined), 'cover', 'por defecto');
  for (const pos of ['center', 'top', 'bottom', 'left', 'right', '50% 30%']) {
    igual(posicionDeLaPortada(pos), pos, `posición ${pos}`);
  }
  igual(posicionDeLaPortada('center; background:red'), 'center', 'basura');
  igual(posicionDeLaPortada(null), 'center', 'nula');
});

// ══════════════════════════════════════════════════════════════════════════
// 3. QUE LA LISTA NO SE SEPARE DE next.config.js
// ══════════════════════════════════════════════════════════════════════════
prueba('cada remotePattern de next.config.js se optimiza, con SU protocolo y SU ruta', () => {
  const cfg = leer('next.config.js');
  const patrones = [...cfg.matchAll(/\{[^{}]*hostname:\s*'([^']+)'[^{}]*\}/g)].map((m) => ({
    host: m[1],
    protocolo: /protocol:\s*'([^']+)'/.exec(m[0])?.[1],
    ruta: /pathname:\s*'([^']+)'/.exec(m[0])?.[1],
  }));
  afirmar(patrones.length >= 7, `no pude leer remotePatterns (${patrones.length})`);
  for (const p of patrones) {
    afirmar(p.protocolo, `patrón sin protocolo: ${p.host} — revisa esOptimizable`);
    const host = p.host.replace(/^\*\*\./, 'algo.').replace(/^\*\./, 'algo.');
    const ruta = p.ruta ? p.ruta.replace(/\*\*$/, 'x.jpg') : '/x.jpg';
    const url = `${p.protocolo}://${host}${ruta}`;
    igual(esOptimizable(url), true, `configurado pero no optimizable: ${url}`);
    const otro = p.protocolo === 'https' ? 'http' : 'https';
    igual(esOptimizable(`${otro}://${host}${ruta}`), false, `otro protocolo daría 400: ${host}`);
    if (p.ruta) {
      igual(esOptimizable(`${p.protocolo}://${host}/otra/x.jpg`), false, `fuera de ${p.ruta}`);
    }
  }
});

prueba('next.config.js no cambia lo que damos por supuesto del optimizador', () => {
  const cfg = leer('next.config.js');
  afirmar(!/deviceSizes|imageSizes/.test(cfg), 'redefine los anchos: revisa ANCHOS_PERMITIDOS');
  // Next 15 obliga a declarar las calidades; con `qualities` puesto, un q=85
  // que no esté en la lista responde 400.
  afirmar(!/qualities/.test(cfg), 'declara qualities: revisa las calidades de aquí');
  afirmar(!/unoptimized/.test(cfg), 'desactiva el optimizador: esto no ahorra nada');
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
// 4. QUE LOS COMPONENTES USEN LO PROBADO
// Sin esto todo lo de arriba sigue verde y el cliente se baja las originales.
// ══════════════════════════════════════════════════════════════════════════
const componentes = [
  [
    'src/components/menu/SectionCoverPreview.tsx',
    [
      ["from '@/lib/menu/imagen-del-menu.mjs'", true],
      ['imagenDelMenu(cfg.bgImageUrl, IMAGEN_DE_PORTADA)', true],
      ['ajusteDeLaPortada(', true],
      ['posicionDeLaPortada(', true],
      // El fondo CSS con la URL cruda es justo lo que se quitó.
      ['backgroundImage: `url(', false],
    ],
  ],
  [
    'src/app/m/[slug]/storefront-client.tsx',
    [
      ["from '@/lib/menu/imagen-del-menu.mjs'", true],
      ['imagenDelMenu(s.logoUrl, IMAGEN_DEL_LOGO)', true],
      ['imagenDelMenu(active.imageUrl, IMAGEN_DEL_AVISO)', true],
      ['imagenDelMenu(cat.imageUrl, IMAGEN_DE_PORTADA)', true],
      ['src={s.logoUrl}', false],
      ['src={active.imageUrl}', false],
      ['url(${cat.imageUrl})', false],
    ],
  ],
];
for (const [ruta, anclas] of componentes) {
  const texto = leer(ruta);
  const mal = anclas
    .filter(([a, debeEstar]) => texto.includes(a) !== debeEstar)
    .map(([a, debeEstar]) => `${debeEstar ? 'falta' : 'sigue'}: ${a}`);
  if (mal.length) {
    fallos++;
    console.log(`\nFALLA  ${ruta} no usa las imágenes probadas:\n       ${mal.join('\n       ')}`);
  } else {
    console.log(`\nok     ${ruta} usa las imágenes probadas`);
  }
}

console.log(`\n${fallos === 0 ? 'TODO VERDE' : `${fallos} FALLO(S)`} — ${casos.length} casos + ${componentes.length} componentes`);
process.exit(fallos === 0 ? 0 : 1);
